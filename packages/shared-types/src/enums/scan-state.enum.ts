export enum ScanState {
  AWAITING_STAGING = 'awaiting_staging',
  STAGED = 'staged',
  CLAIMED = 'claimed',
  SCANNING = 'scanning',
  SCAN_COMPLETE = 'scan_complete',
  GROUPING_COMPLETE = 'grouping_complete',
  PENDING_CLEANUP = 'pending_cleanup',
  CLEANUP_ALLOWED = 'cleanup_allowed',
  CLEANED = 'cleaned',
  FAILED = 'failed',
}
