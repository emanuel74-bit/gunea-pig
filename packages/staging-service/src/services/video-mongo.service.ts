import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  VideoDocument,
  ScanState,
  SimilarityStatus,
} from '@gunea-pig/shared';

export interface VideoStagingRecord {
  videoId: string;
  s3Key: string;
  s3Bucket: string;
  scanState: ScanState;
  stagedPath?: string;
  stagingAttempts: number;
}

/**
 * Repository role — all MongoDB access for video staging state.
 * Enforces idempotency: safe to call with the same videoId multiple times.
 */
@Injectable()
export class VideoMongoService {
  private readonly logger = new Logger(VideoMongoService.name);

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
  ) {}

  /**
   * Returns the video document if it exists, or null.
   */
  async findByVideoId(videoId: string): Promise<VideoDocument | null> {
    return this.videoModel.findOne({ videoId }).lean<VideoDocument>().exec();
  }

  /**
   * Idempotent upsert: creates the video record if absent,
   * returns the existing record without modification if already present.
   */
  async upsertPendingStaging(
    videoId: string,
    s3Key: string,
    s3Bucket: string,
  ): Promise<VideoDocument> {
    const result = await this.videoModel
      .findOneAndUpdate(
        { videoId },
        {
          $setOnInsert: {
            videoId,
            s3Key,
            s3Bucket,
            scanState: ScanState.PENDING_STAGING,
            similarityStatus: SimilarityStatus.UNPROCESSED,
            stagingAttempts: 0,
          },
        },
        { upsert: true, new: true },
      )
      .lean<VideoDocument>()
      .exec();

    if (!result) throw new Error(`[VideoMongoService] upsert failed for videoId=${videoId}`);
    return result;
  }

  /**
   * Marks the video as staged with the local filesystem path.
   * Only transitions from PENDING_STAGING → STAGED.
   */
  async markStaged(videoId: string, stagedPath: string): Promise<void> {
    const result = await this.videoModel.updateOne(
      { videoId, scanState: ScanState.PENDING_STAGING },
      {
        $set: { scanState: ScanState.STAGED, stagedPath },
        $inc: { stagingAttempts: 1 },
      },
    );
    if (result.matchedCount === 0) {
      this.logger.warn(`markStaged: no PENDING_STAGING record found for videoId=${videoId}`);
    }
  }

  /**
   * Marks the video as failed after a staging error.
   */
  async markStagingFailed(videoId: string): Promise<void> {
    await this.videoModel.updateOne(
      { videoId },
      {
        $set: { scanState: ScanState.SCAN_FAILED },
        $inc: { stagingAttempts: 1 },
      },
    );
  }

  /**
   * Returns true if the video is already staged or beyond (scan_claimed, etc.).
   * Used for idempotency check — avoids re-staging an already-staged video.
   */
  async isAlreadyStaged(videoId: string): Promise<boolean> {
    const nonStageable: ScanState[] = [
      ScanState.STAGED,
      ScanState.SCAN_CLAIMED,
      ScanState.SCAN_COMPLETED,
      ScanState.GROUPING_COMPLETED,
    ];
    const doc = await this.videoModel
      .findOne({ videoId, scanState: { $in: nonStageable } })
      .lean()
      .exec();
    return doc !== null;
  }
}
