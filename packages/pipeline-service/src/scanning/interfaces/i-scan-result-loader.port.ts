export const I_SCAN_RESULT_LOADER = Symbol('IScanResultLoader');

export interface IScanResultLoader {
  loadResult(bucket: string, key: string): Promise<unknown>;
}
