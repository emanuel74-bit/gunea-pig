export const I_VIDEO_SCAN_REPOSITORY = Symbol('IVideoScanRepository');

export interface IVideoScanRepository {
  buildVideoIdMap(videoIds: string[]): Promise<Record<string, string>>;
  markScanCompleted(videoIds: string[], scanId: string): Promise<void>;
  markScanFailed(videoIds: string[]): Promise<void>;
}
