import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model } from 'mongoose';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  VideoDocument,
  ScanBatchDocument,
  ScanBatchStatus,
  ScanState,
  S3Adapter,
  RabbitMQPublisher,
  QUEUE_EXCHANGES,
  ROUTING_KEYS,
  ScanCompletedEvent,
} from '@gunea-pig/shared';
import { BatchClaimer } from '../batch/batch-claimer';
import { VdfRunner } from '../batch/vdf-runner';
import { Purger } from '../batch/purger';
import { ManifestService } from './manifest.service';
import { VdfScanConfig } from '../config';
import { VDF_SCAN_CONFIG } from '../injection-tokens';

/**
 * Orchestrator role — coordinates the full VDF scan lifecycle:
 * claim → scan → normalize → export to S3 → publish event → cleanup gate.
 *
 * Runs on a configurable interval via NestJS scheduler.
 * Must not merge similarity groups.
 * Must not publish large result payloads to RabbitMQ.
 */
@Injectable()
export class ScanOrchestratorService {
  private readonly logger = new Logger(ScanOrchestratorService.name);
  private isRunning = false;

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
    private readonly batchClaimer: BatchClaimer,
    private readonly vdfRunner: VdfRunner,
    private readonly purger: Purger,
    private readonly manifestService: ManifestService,
    private readonly s3: S3Adapter,
    private readonly publisher: RabbitMQPublisher,
    @Inject(VDF_SCAN_CONFIG)
    private readonly config: VdfScanConfig,
  ) {}

  /**
   * Main scan cycle — runs on the configured interval.
   * Guarded by isRunning flag to prevent overlapping executions.
   */
  @Interval(30_000)
  async runScanCycle(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Scan cycle already running — skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      await this.processPendingBatches();
      await this.purger.runCleanupPass(this.config.vdf.resultRetentionSeconds);
    } finally {
      this.isRunning = false;
    }
  }

  private async processPendingBatches(): Promise<void> {
    const batch = await this.batchClaimer.claimNextBatch(
      this.config.vdf.batchSize,
      this.config.ownerId,
      this.config.vdf.batchClaimTtlSeconds,
    );

    if (!batch) {
      this.logger.debug('No staged videos available for scanning');
      return;
    }

    const { scanId, videoIds } = batch;

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.CLAIMED,
      ScanBatchStatus.SCANNING,
    );

    // Build videoId ↔ filename map (filename = videoId + original extension)
    const videoIdMap = await this.buildVideoIdMap(videoIds);

    let vdfOutputPath: string;
    try {
      const outputDir = path.join(this.config.vdf.scanPath, '.vdf-output');
      const result = await this.vdfRunner.run({
        cliPath: this.config.vdf.cliPath,
        scanPath: this.config.vdf.scanPath,
        outputDir,
        scanId,
        timeoutMs: this.config.vdf.batchClaimTtlSeconds * 1000 * 0.8, // 80% of TTL
      });
      vdfOutputPath = result.outputPath;
    } catch (err) {
      const error = err as Error;
      this.logger.error({ scanId, err: error.message }, 'VDF scan failed');
      await this.batchClaimer.transitionBatchStatus(
        scanId,
        ScanBatchStatus.SCANNING,
        ScanBatchStatus.FAILED,
        { failReason: error.message } as Partial<ScanBatchDocument>,
      );
      await this.videoModel.updateMany(
        { videoId: { $in: videoIds } },
        { $set: { scanState: ScanState.SCAN_FAILED } },
      );
      return;
    }

    // Normalize VDF output into canonical schema
    const normalized = this.manifestService.normalize(
      scanId,
      vdfOutputPath,
      videoIdMap,
      this.config.vdf.scannerVersion,
      this.config.vdf.scannerProfile,
    );

    // Export normalized result to S3 (durable handoff)
    const resultS3Key = `scans/${scanId}/result.json`;
    await this.s3.putJson(
      { bucket: this.config.s3.bucketScanResults, key: resultS3Key },
      normalized,
    );

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.SCANNING,
      ScanBatchStatus.SCAN_EXPORTED,
      {
        resultS3Key,
        resultS3Bucket: this.config.s3.bucketScanResults,
      } as Partial<ScanBatchDocument>,
    );

    // Update video states
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      { $set: { scanState: ScanState.SCAN_COMPLETED, scanId } },
    );

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.SCAN_EXPORTED,
      ScanBatchStatus.PENDING_GROUPING,
    );

    // Publish lightweight scan-completed event (NOT the result payload)
    const correlationId = uuidv4();
    const event: ScanCompletedEvent = {
      eventId: uuidv4(),
      schemaVersion: '1.0',
      scanId,
      resultS3Key,
      resultS3Bucket: this.config.s3.bucketScanResults,
      videoIds,
      scannerVersion: this.config.vdf.scannerVersion,
      scannerProfile: this.config.vdf.scannerProfile,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    await this.publisher.publish({
      exchange: QUEUE_EXCHANGES.SCAN_EVENTS,
      routingKey: ROUTING_KEYS.SCAN_COMPLETED,
      payload: event as unknown as Record<string, unknown>,
      correlationId,
    });

    this.logger.log(
      { scanId, videoCount: videoIds.length, resultS3Key },
      'Scan completed and published',
    );
  }

  /**
   * Builds a map of { videoId → videoId } (filename stem → videoId).
   * The staged filename is `{videoId}{ext}`, so the stem is the videoId itself.
   */
  private async buildVideoIdMap(videoIds: string[]): Promise<Record<string, string>> {
    const docs = await this.videoModel
      .find({ videoId: { $in: videoIds } })
      .select('videoId stagedPath')
      .lean<{ videoId: string; stagedPath?: string }[]>()
      .exec();

    const map: Record<string, string> = {};
    for (const doc of docs) {
      if (doc.stagedPath) {
        const stem = path.basename(doc.stagedPath, path.extname(doc.stagedPath));
        map[stem] = doc.videoId;
      }
      // Also map videoId directly as fallback
      map[doc.videoId] = doc.videoId;
    }
    return map;
  }
}
