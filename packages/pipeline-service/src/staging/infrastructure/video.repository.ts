import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoDocument, ScanState, SimilarityStatus } from '@gunea-pig/shared';
import { VideoStagingPolicy } from '../domain/video-staging.policy';
import { IVideoRepository } from '../interfaces/i-video-repository.port';

@Injectable()
export class VideoRepository implements IVideoRepository {
  private readonly logger = new Logger(VideoRepository.name);

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
  ) {}

  async findByVideoId(videoId: string): Promise<VideoDocument | null> {
    return this.videoModel.findOne({ videoId }).lean<VideoDocument>().exec();
  }

  async upsertPendingStaging(
    videoId: string,
    s3Key: string,
    s3Bucket: string,
  ): Promise<void> {
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

    if (!result) throw new Error(`[VideoRepository] upsert failed for videoId=${videoId}`);
  }

  async markStaged(videoId: string, stagedPath: string): Promise<void> {
    const result = await this.videoModel.updateOne(
      { videoId, scanState: ScanState.PENDING_STAGING },
      {
        $set: { scanState: ScanState.STAGED, stagedPath },
        $inc: { stagingAttempts: 1 },
      },
    );
    if (result.matchedCount === 0) {
      this.logger.warn(`markStaged: no PENDING_STAGING record for videoId=${videoId}`);
    }
  }

  async markStagingFailed(videoId: string): Promise<void> {
    await this.videoModel.updateOne(
      { videoId },
      {
        $set: { scanState: ScanState.SCAN_FAILED },
        $inc: { stagingAttempts: 1 },
      },
    );
  }

  async isAlreadyStaged(videoId: string): Promise<boolean> {
    const doc = await this.videoModel
      .findOne({ videoId, scanState: { $in: VideoStagingPolicy.nonStageableStates() } })
      .lean()
      .exec();
    return doc !== null;
  }
}
