import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScanBatchDocument, ScanBatchStatus } from '@gunea-pig/shared';
import { VdfRunnerAdapter } from './vdf-runner.adapter';
import { VideoScanRepository } from './video-scan.repository';
import { ScanCleanupPolicy } from '../domain/scan-cleanup.policy';
import { SCAN_OUTPUT_DIR } from '../injection-tokens';

@Injectable()
export class ScanPurgerService {
  private readonly logger = new Logger(ScanPurgerService.name);

  constructor(
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
    private readonly vdfRunner: VdfRunnerAdapter,
    private readonly videoScanRepository: VideoScanRepository,
    @Inject(SCAN_OUTPUT_DIR)
    private readonly scanOutputDir: string,
  ) {}

  async runCleanupPass(retentionSeconds: number): Promise<void> {
    await this.cleanupGroupingCompletedBatches();
    await this.expireStaleRetainedBatches(retentionSeconds);
  }

  private async cleanupGroupingCompletedBatches(): Promise<void> {
    await this.scanBatchModel.updateMany(
      { status: ScanBatchStatus.GROUPING_COMPLETED },
      { $set: { status: ScanBatchStatus.PENDING_CLEANUP } },
    );

    const pending = await this.scanBatchModel
      .find({ status: ScanBatchStatus.PENDING_CLEANUP })
      .lean<ScanBatchDocument[]>()
      .exec();

    for (const batch of pending) {
      await this.performCleanup(batch);
    }
  }

  private async performCleanup(batch: ScanBatchDocument): Promise<void> {
    const { scanId, videoIds } = batch;
    try {
      await this.scanBatchModel.updateOne(
        { scanId },
        { $set: { status: ScanBatchStatus.CLEANUP_ALLOWED } },
      );

      await this.vdfRunner.cleanupScanArtifacts(this.scanOutputDir, scanId);
      await this.videoScanRepository.markGroupingCompleted(videoIds);

      await this.scanBatchModel.updateOne(
        { scanId },
        { $set: { status: ScanBatchStatus.CLEANED, cleanedAt: new Date() } },
      );

      this.logger.log({ scanId, videoCount: videoIds.length }, 'Scan batch cleaned');
    } catch (err) {
      const error = err as Error;
      this.logger.error({ scanId, err: error.message }, 'Cleanup failed');
      await this.scanBatchModel
        .updateOne({ scanId }, { $set: { status: ScanBatchStatus.CLEANUP_FAILED } })
        .catch(() => undefined);
    }
  }

  private async expireStaleRetainedBatches(retentionSeconds: number): Promise<void> {
    const now = new Date();
    const expired = await this.scanBatchModel
      .find({ status: ScanCleanupPolicy.STALE_AWAITING_STATUS })
      .lean<ScanBatchDocument[]>()
      .exec();

    for (const batch of expired) {
      if (ScanCleanupPolicy.isStaleForRetention(batch.updatedAt as Date, retentionSeconds, now)) {
        this.logger.warn({ scanId: batch.scanId }, 'Scan batch expired without grouping');
        await this.scanBatchModel.updateOne(
          { scanId: batch.scanId },
          { $set: { status: ScanBatchStatus.EXPIRED } },
        );
      }
    }
  }
}
