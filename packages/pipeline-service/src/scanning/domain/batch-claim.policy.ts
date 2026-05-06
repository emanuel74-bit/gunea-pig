import { ScanBatchStatus } from '@gunea-pig/shared';

export class BatchClaimPolicy {
  static readonly CLAIMABLE_STATE = 'staged' as const;

  static readonly EXPIRABLE_STATUSES: readonly ScanBatchStatus[] = [
    ScanBatchStatus.CLAIMED,
    ScanBatchStatus.SCANNING,
  ];

  static isExpirable(status: ScanBatchStatus): boolean {
    return BatchClaimPolicy.EXPIRABLE_STATUSES.includes(status);
  }

  static expiresAt(claimedAt: Date, ttlSeconds: number): Date {
    return new Date(claimedAt.getTime() + ttlSeconds * 1_000);
  }

  static isExpired(expiresAt: Date, now: Date): boolean {
    return expiresAt < now;
  }
}
