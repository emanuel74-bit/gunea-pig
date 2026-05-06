import { ScanBatchStatus } from '@gunea-pig/shared';

export class ScanCleanupPolicy {
  static readonly CLEANUP_TRIGGER_STATUS = ScanBatchStatus.GROUPING_COMPLETED;

  static readonly STALE_AWAITING_STATUS = ScanBatchStatus.PENDING_GROUPING;

  static isCleanupTriggered(status: ScanBatchStatus): boolean {
    return status === ScanCleanupPolicy.CLEANUP_TRIGGER_STATUS;
  }

  static isStaleForRetention(updatedAt: Date, retentionSeconds: number, now: Date): boolean {
    const cutoff = new Date(now.getTime() - retentionSeconds * 1_000);
    return updatedAt < cutoff;
  }
}
