export const I_VIDEO_REPOSITORY = Symbol('IVideoRepository');

export interface IVideoRepository {
  isAlreadyStaged(videoId: string): Promise<boolean>;
  upsertPendingStaging(videoId: string, s3ObjectKey: string, s3Bucket: string): Promise<void>;
  markStaged(videoId: string, stagedPath: string): Promise<void>;
  markStagingFailed(videoId: string): Promise<void>;
}
