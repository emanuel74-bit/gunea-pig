export const I_BATCH_CLAIMER = Symbol('IBatchClaimerPort');

export interface IBatchClaimerPort {
  claimNextBatch(batchSize: number, ownerId: string, ttlSeconds: number): Promise<{ scanId: string; videoIds: string[] } | null>;
  transitionBatchStatus(scanId: string, from: string, to: string, patch?: Record<string, unknown>): Promise<void>;
}
