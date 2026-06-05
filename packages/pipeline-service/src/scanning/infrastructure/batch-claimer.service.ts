import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { VideoDocument, ScanBatchDocument, ScanState, ScanBatchStatus } from '@gunea-pig/shared';
import { BatchClaimPolicy } from '../domain/batch-claim.policy';
import { IBatchClaimerPort } from '../interfaces/i-batch-claimer.port';

export interface ClaimedBatch {
  scanId: string;
  videoIds: string[];
  claimedAt: Date;
  expiresAt: Date;
}

@Injectable()
export class BatchClaimerService implements IBatchClaimerPort {
  private readonly logger = new Logger(BatchClaimerService.name);

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
  ) {}

  async claimNextBatch(
    batchSize: number,
    ownerId: string,
    ttlSeconds: number,
  ): Promise<ClaimedBatch | null> {
    await this.recoverExpiredClaims();

    const candidates = await this.videoModel
      .find({ scanState: ScanState.STAGED })
      .limit(batchSize)
      .select('videoId')
      .lean<{ videoId: string }[]>()
      .exec();

    if (candidates.length === 0) return null;

    const videoIds = candidates.map((c) => c.videoId);
    const scanId = uuidv4();
    const claimedAt = new Date();
    const expiresAt = BatchClaimPolicy.expiresAt(claimedAt, ttlSeconds);

    const updateResult = await this.videoModel.updateMany(
      { videoId: { $in: videoIds }, scanState: ScanState.STAGED },
      { $set: { scanState: ScanState.SCAN_CLAIMED, scanClaimId: scanId } },
    );

    if (updateResult.modifiedCount === 0) {
      this.logger.warn('claimNextBatch: no videos updated (concurrent claim race)');
      return null;
    }

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

    this.logger.log({ scanId, videoCount: actualVideoIds.length, ownerId }, 'Batch claimed');
    return { scanId, videoIds: actualVideoIds, claimedAt, expiresAt };
  }

  async transitionBatchStatus(
    scanId: string,
    expectedStatus: ScanBatchStatus,
    newStatus: ScanBatchStatus,
    extra?: Partial<ScanBatchDocument>,
  ): Promise<void> {
    const result = await this.scanBatchModel.findOneAndUpdate(
      { scanId, status: expectedStatus },
      { $set: { status: newStatus, ...extra } },
      { new: true },
    );
    if (!result) {
      this.logger.warn(
        { scanId, expectedStatus, newStatus },
        'Batch status transition failed — unexpected state',
      );
    }
  }

  async getBatch(scanId: string): Promise<ScanBatchDocument | null> {
    return this.scanBatchModel.findOne({ scanId }).lean<ScanBatchDocument>().exec();
  }

  private async recoverExpiredClaims(): Promise<void> {
    const now = new Date();
    const expired = await this.scanBatchModel
      .find({ status: { $in: BatchClaimPolicy.EXPIRABLE_STATUSES }, expiresAt: { $lt: now } })
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
