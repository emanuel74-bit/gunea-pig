import { NormalizedScanResult } from '@gunea-pig/shared';

export const I_GROUPING_SCAN_RESULT_LOADER = Symbol('IGroupingScanResultLoader');

export interface IGroupingScanResultLoader {
  load(resultS3Bucket: string, resultS3Key: string): Promise<NormalizedScanResult>;
}
