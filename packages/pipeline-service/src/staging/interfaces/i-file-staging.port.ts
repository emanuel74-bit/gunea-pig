export const I_FILE_STAGING = Symbol('IFileStagingPort');

export interface IFileStagingPort {
  verifyS3ObjectExists(bucket: string, key: string): Promise<void>;
  stageFromS3(videoId: string, bucket: string, key: string): Promise<{ stagedPath: string }>;
}
