export const I_SCAN_BATCH_REPOSITORY = Symbol('IScanBatchRepository');

export interface IScanBatchRepository {
  claimNextBatch(batchSize: number, ownerId: string, ttlSeconds: number): Promise<{ scanId: string; videoIds: string[] } | null>;
  transitionBatchStatus(scanId: string, from: string, to: string, patch?: Record<string, unknown>): Promise<void>;
}
