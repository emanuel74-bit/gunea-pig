export const I_GROUPING_SCAN_BATCH_REPOSITORY = Symbol('IGroupingScanBatchRepository');

export interface IGroupingScanBatchRepository {
  isAlreadyGrouped(scanId: string): Promise<boolean>;
  markGroupingCompleted(scanId: string): Promise<void>;
}
