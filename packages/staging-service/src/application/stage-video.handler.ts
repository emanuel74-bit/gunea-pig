import { Injectable, Logger } from '@nestjs/common';
import { NewVideoReadyEvent } from '@gunea-pig/shared';
import { VideoRepository } from '../infrastructure/video.repository';
import { FileStagingAdapter, S3ObjectNotFoundError } from '../infrastructure/file-staging.adapter';

export class VideoAlreadyStagedError extends Error {
  constructor(public readonly videoId: string) {
    super(`Video already staged: videoId=${videoId}`);
    this.name = 'VideoAlreadyStagedError';
  }
}

export class StagingPermanentFailureError extends Error {
  constructor(
    public readonly videoId: string,
    cause: Error,
  ) {
    super(`Permanent staging failure for videoId=${videoId}: ${cause.message}`);
    this.name = 'StagingPermanentFailureError';
    this.cause = cause;
  }
}

@Injectable()
export class StageVideoHandler {
  private readonly logger = new Logger(StageVideoHandler.name);

  constructor(
    private readonly videoRepository: VideoRepository,
    private readonly fileStagingAdapter: FileStagingAdapter,
  ) {}

  async handle(event: NewVideoReadyEvent): Promise<void> {
    const { videoId, s3ObjectKey, s3Bucket, correlationId } = event;

    const alreadyStaged = await this.videoRepository.isAlreadyStaged(videoId);
    if (alreadyStaged) {
      throw new VideoAlreadyStagedError(videoId);
    }

    await this.videoRepository.upsertPendingStaging(videoId, s3ObjectKey, s3Bucket);

    try {
      await this.fileStagingAdapter.verifyS3ObjectExists(s3Bucket, s3ObjectKey);
      const { stagedPath } = await this.fileStagingAdapter.stageFromS3(
        videoId,
        s3Bucket,
        s3ObjectKey,
      );
      await this.videoRepository.markStaged(videoId, stagedPath);
      this.logger.log({ videoId, stagedPath, correlationId }, 'Video staged successfully');
    } catch (err) {
      await this.videoRepository.markStagingFailed(videoId).catch(() => undefined);
      if (err instanceof S3ObjectNotFoundError) {
        throw new StagingPermanentFailureError(videoId, err);
      }
      throw err;
    }
  }
}
