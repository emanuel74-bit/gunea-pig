import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ScanBatchDocument,
  VideoDocument,
  ScanBatchStatus,
  ScanState,
} from '@gunea-pig/shared';
import { VdfRunner } from './vdf-runner';
import { SCAN_OUTPUT_DIR } from '../injection-tokens';

/**
 * Service role — safe cleanup of local scan artifacts and VDF state.
 *
 * Cleanup is only allowed after one of:
 * 1. Grouping service has confirmed persistence (ScanBatchStatus.GROUPING_COMPLETED).
 * 2. Retention period has expired and the batch is recoverable as expired.
 *
 * This enforces the safe-cleanup requirement from the system spec.
 */
@Injectable()
export class Purger {
  private readonly logger = new Logger(Purger.name);

  constructor(
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
    private readonly vdfRunner: VdfRunner,
    @Inject(SCAN_OUTPUT_DIR)
    private readonly scanOutputDir: string,
  ) {}

  /**
   * Processes all batches eligible for cleanup:
   * - GROUPING_COMPLETED → cleanup_allowed → cleaned
   * - Expired batches where retention period has passed
   */
  async runCleanupPass(retentionSeconds: number): Promise<void> {
    await this.cleanupGroupingCompletedBatches();
    await this.expireRetainedBatches(retentionSeconds);
  }

  /**
   * Marks batches with GROUPING_COMPLETED status as cleanup_allowed,
   * then performs artifact removal and transitions to cleaned.
   */
  private async cleanupGroupingCompletedBatches(): Promise<void> {
    // Transition GROUPING_COMPLETED → PENDING_CLEANUP
    await this.scanBatchModel.updateMany(
      { status: ScanBatchStatus.GROUPING_COMPLETED },
      { $set: { status: ScanBatchStatus.PENDING_CLEANUP } },
    );

    const pendingCleanup = await this.scanBatchModel
      .find({ status: ScanBatchStatus.PENDING_CLEANUP })
      .lean<ScanBatchDocument[]>()
      .exec();

    for (const batch of pendingCleanup) {
      await this.performCleanup(batch);
    }
  }

  private async performCleanup(batch: ScanBatchDocument): Promise<void> {
    const { scanId, videoIds } = batch;
    try {
      // Mark as cleanup_allowed before removing
      await this.scanBatchModel.updateOne(
        { scanId },
        { $set: { status: ScanBatchStatus.CLEANUP_ALLOWED } },
      );

      // Remove VDF output artifact
      await this.vdfRunner.cleanupScanArtifacts(this.scanOutputDir, scanId);

      // Mark videos as grouping_completed
      await this.videoModel.updateMany(
        { videoId: { $in: videoIds }, scanState: ScanState.SCAN_COMPLETED },
        { $set: { scanState: ScanState.GROUPING_COMPLETED } },
      );

      await this.scanBatchModel.updateOne(
        { scanId },
        { $set: { status: ScanBatchStatus.CLEANED, cleanedAt: new Date() } },
      );

      this.logger.log({ scanId, videoCount: videoIds.length }, 'Scan batch cleaned up');
    } catch (err) {
      const error = err as Error;
      this.logger.error({ scanId, err: error.message }, 'Cleanup failed');
      await this.scanBatchModel
        .updateOne({ scanId }, { $set: { status: ScanBatchStatus.CLEANUP_FAILED } })
        .catch(() => undefined);
    }
  }

  /**
   * Expires batches that have been in PENDING_GROUPING longer than the
   * configured retention window. These batches' S3 results may still be
   * accessible for replay, but local artifacts can be released.
   */
  private async expireRetainedBatches(retentionSeconds: number): Promise<void> {
    const cutoff = new Date(Date.now() - retentionSeconds * 1000);
    const expired = await this.scanBatchModel
      .find({
        status: ScanBatchStatus.PENDING_GROUPING,
        updatedAt: { $lt: cutoff },
      })
      .lean<ScanBatchDocument[]>()
      .exec();

    for (const batch of expired) {
      this.logger.warn({ scanId: batch.scanId }, 'Scan batch expired without grouping confirmation');
      await this.scanBatchModel.updateOne(
        { scanId: batch.scanId },
        { $set: { status: ScanBatchStatus.EXPIRED } },
      );
    }
  }
}
