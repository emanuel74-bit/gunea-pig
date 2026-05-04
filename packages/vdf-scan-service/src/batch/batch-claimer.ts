import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  VideoDocument,
  ScanBatchDocument,
  ScanState,
  ScanBatchStatus,
} from '@gunea-pig/shared';

export interface ClaimedBatch {
  scanId: string;
  videoIds: string[];
  claimedAt: Date;
  expiresAt: Date;
}

/**
 * Service role — durable batch claiming with MongoDB atomic operations.
 *
 * Prevents concurrent scanner workers from claiming the same videos.
 * Uses optimistic locking via findOneAndUpdate with state predicates.
 * Supports expiry recovery for abandoned/crashed scan workers.
 */
@Injectable()
export class BatchClaimer {
  private readonly logger = new Logger(BatchClaimer.name);

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
  ) {}

  /**
   * Attempts to atomically claim up to `batchSize` staged videos.
   * Returns null if no staged videos are available.
   * The claim is durable in MongoDB — survives process restart.
   */
  async claimNextBatch(
    batchSize: number,
    ownerId: string,
    ttlSeconds: number,
  ): Promise<ClaimedBatch | null> {
    // First, recover any expired claims so their videos become available again
    await this.recoverExpiredClaims();

    // Find staged videos not yet claimed
    const candidates = await this.videoModel
      .find({ scanState: ScanState.STAGED })
      .limit(batchSize)
      .select('videoId')
      .lean<{ videoId: string }[]>()
      .exec();

    if (candidates.length === 0) {
      return null;
    }

    const videoIds = candidates.map((c) => c.videoId);
    const scanId = uuidv4();
    const claimedAt = new Date();
    const expiresAt = new Date(claimedAt.getTime() + ttlSeconds * 1000);

    // Atomically mark all selected videos as claimed
    const updateResult = await this.videoModel.updateMany(
      { videoId: { $in: videoIds }, scanState: ScanState.STAGED },
      { $set: { scanState: ScanState.SCAN_CLAIMED, scanClaimId: scanId } },
    );

    if (updateResult.modifiedCount === 0) {
      this.logger.warn('claimNextBatch: no videos were updated (concurrent claim race)');
      return null;
    }

    // Create durable batch record
    const actualVideoIds = await this.videoModel
      .find({ scanClaimId: scanId, scanState: ScanState.SCAN_CLAIMED })
      .select('videoId')
      .lean<{ videoId: string }[]>()
      .exec()
      .then((docs) => docs.map((d) => d.videoId));

    await this.scanBatchModel.create({
      scanId,
      status: ScanBatchStatus.CLAIMED,
      videoIds: actualVideoIds,
      ownerId,
      claimedAt,
      expiresAt,
      retryCount: 0,
    });

    this.logger.log(
      { scanId, videoCount: actualVideoIds.length, ownerId },
      'Batch claimed',
    );

    return { scanId, videoIds: actualVideoIds, claimedAt, expiresAt };
  }

  async transitionBatchStatus(
    scanId: string,
    expectedStatus: ScanBatchStatus,
    newStatus: ScanBatchStatus,
    extra?: Partial<ScanBatchDocument>,
  ): Promise<boolean> {
    const result = await this.scanBatchModel.findOneAndUpdate(
      { scanId, status: expectedStatus },
      { $set: { status: newStatus, ...extra } },
      { new: true },
    );
    if (!result) {
      this.logger.warn(
        { scanId, expectedStatus, newStatus },
        'Batch status transition failed — unexpected current state',
      );
      return false;
    }
    return true;
  }

  async getBatch(scanId: string): Promise<ScanBatchDocument | null> {
    return this.scanBatchModel.findOne({ scanId }).lean<ScanBatchDocument>().exec();
  }

  /**
   * Recovers abandoned batch claims whose TTL has expired.
   * Resets video scanState back to STAGED so they can be re-claimed.
   */
  private async recoverExpiredClaims(): Promise<void> {
    const now = new Date();
    const expired = await this.scanBatchModel
      .find({
        status: { $in: [ScanBatchStatus.CLAIMED, ScanBatchStatus.SCANNING] },
        expiresAt: { $lt: now },
      })
      .lean<ScanBatchDocument[]>()
      .exec();

    for (const batch of expired) {
      this.logger.warn({ scanId: batch.scanId }, 'Recovering expired batch claim');
      await this.videoModel.updateMany(
        { videoId: { $in: batch.videoIds }, scanState: ScanState.SCAN_CLAIMED },
        { $set: { scanState: ScanState.STAGED }, $unset: { scanClaimId: '' } },
      );
      await this.scanBatchModel.updateOne(
        { scanId: batch.scanId },
        { $set: { status: ScanBatchStatus.EXPIRED } },
      );
    }
  }
}
