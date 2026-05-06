import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ScanBatchDocument,
  ScanBatchStatus,
  S3Adapter,
  RabbitMQPublisher,
  QUEUE_EXCHANGES,
  ROUTING_KEYS,
  ScanCompletedEvent,
} from '@gunea-pig/shared';
import { BatchClaimerService } from '../infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from '../infrastructure/vdf-runner.adapter';
import { ScanPurgerService } from '../infrastructure/scan-purger.service';
import { VdfManifestNormalizer } from '../infrastructure/vdf-manifest.normalizer';
import { VideoScanRepository } from '../infrastructure/video-scan.repository';
import { VdfScanConfig } from '../config';
import { VDF_SCAN_CONFIG } from '../injection-tokens';

@Injectable()
export class ScanOrchestrator {
  private readonly logger = new Logger(ScanOrchestrator.name);
  private isRunning = false;

  constructor(
    private readonly batchClaimer: BatchClaimerService,
    private readonly vdfRunner: VdfRunnerAdapter,
    private readonly purger: ScanPurgerService,
    private readonly manifestNormalizer: VdfManifestNormalizer,
    private readonly videoScanRepository: VideoScanRepository,
    private readonly s3: S3Adapter,
    private readonly publisher: RabbitMQPublisher,
    @Inject(VDF_SCAN_CONFIG)
    private readonly config: VdfScanConfig,
  ) {}

  @Interval(30_000)
  async runScanCycle(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Scan cycle already running — skipping tick');
      return;
    }
    this.isRunning = true;
    try {
      await this.processPendingBatch();
      await this.purger.runCleanupPass(this.config.vdf.resultRetentionSeconds);
    } finally {
      this.isRunning = false;
    }
  }

  private async processPendingBatch(): Promise<void> {
    const batch = await this.batchClaimer.claimNextBatch(
      this.config.vdf.batchSize,
      this.config.ownerId,
      this.config.vdf.batchClaimTtlSeconds,
    );

    if (!batch) {
      this.logger.debug('No staged videos available');
      return;
    }

    const { scanId, videoIds } = batch;

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.CLAIMED,
      ScanBatchStatus.SCANNING,
    );

    const videoIdMap = await this.videoScanRepository.buildVideoIdMap(videoIds);

    let vdfOutputPath: string;
    try {
      const outputDir = path.join(this.config.vdf.scanPath, '.vdf-output');
      const result = await this.vdfRunner.run({
        cliPath: this.config.vdf.cliPath,
        scanPath: this.config.vdf.scanPath,
        outputDir,
        scanId,
        timeoutMs: this.config.vdf.batchClaimTtlSeconds * 1_000 * 0.8,
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
      await this.videoScanRepository.markScanFailed(videoIds);
      return;
    }

    const normalized = this.manifestNormalizer.normalize(
      scanId,
      vdfOutputPath,
      videoIdMap,
      this.config.vdf.scannerVersion,
      this.config.vdf.scannerProfile,
    );

    const resultS3Key = `scans/${scanId}/result.json`;
    await this.s3.putJson({ bucket: this.config.s3.bucketScanResults, key: resultS3Key }, normalized);

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.SCANNING,
      ScanBatchStatus.SCAN_EXPORTED,
      { resultS3Key, resultS3Bucket: this.config.s3.bucketScanResults } as Partial<ScanBatchDocument>,
    );

    await this.videoScanRepository.markScanCompleted(videoIds, scanId);

    await this.batchClaimer.transitionBatchStatus(
      scanId,
      ScanBatchStatus.SCAN_EXPORTED,
      ScanBatchStatus.PENDING_GROUPING,
    );

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

    this.logger.log({ scanId, videoCount: videoIds.length, resultS3Key }, 'Scan completed and published');
  }
}
