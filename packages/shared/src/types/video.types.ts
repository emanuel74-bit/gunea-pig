/**
 * Scan state lifecycle for a single video document.
 * Transitions are one-directional (State pattern).
 */
export enum ScanState {
  /** Video is known but not yet staged to the local scan path. */
  PENDING_STAGING = 'pending_staging',
  /** Video file has been copied to the local scan filesystem path. */
  STAGED = 'staged',
  /** Video has been claimed by a VDF batch scan. */
  SCAN_CLAIMED = 'scan_claimed',
  /** VDF has scanned the video and results are exported. */
  SCAN_COMPLETED = 'scan_completed',
  /** VDF scanning or staging failed after max retries. */
  SCAN_FAILED = 'scan_failed',
  /** Similarity grouping has been applied to this video. */
  GROUPING_COMPLETED = 'grouping_completed',
}

/**
 * Similarity status assigned to a video after grouping.
 */
export enum SimilarityStatus {
  UNPROCESSED = 'unprocessed',
  NO_MATCHES = 'no_matches',
  HAS_MATCHES = 'has_matches',
  IN_GROUP = 'in_group',
}

/**
 * Lifecycle states for a VDF batch scan claim.
 * Governs when cleanup is allowed (safe-cleanup pattern).
 */
export enum ScanBatchStatus {
  CLAIMED = 'claimed',
  SCANNING = 'scanning',
  SCAN_EXPORTED = 'scan_exported',
  PENDING_GROUPING = 'pending_grouping',
  GROUPING_COMPLETED = 'grouping_completed',
  PENDING_CLEANUP = 'pending_cleanup',
  CLEANUP_ALLOWED = 'cleanup_allowed',
  CLEANED = 'cleaned',
  CLEANUP_FAILED = 'cleanup_failed',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

/** Plain interface matching the MongoDB video document shape. */
export interface IVideoDocument {
  videoId: string;
  s3Key: string;
  s3Bucket: string;
  scanState: ScanState;
  stagedPath?: string;
  scanClaimId?: string;
  scanId?: string;
  scanCompletedAt?: Date;
  similarityGroupId?: string;
  similarityStatus?: SimilarityStatus;
  matchCount?: number;
  stagingAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Plain interface matching the MongoDB scan_batch document shape. */
export interface IScanBatch {
  scanId: string;
  status: ScanBatchStatus;
  videoIds: string[];
  ownerId: string;
  claimedAt: Date;
  expiresAt: Date;
  resultS3Key?: string;
  resultS3Bucket?: string;
  groupingConfirmedAt?: Date;
  cleanedAt?: Date;
  retryCount: number;
  failReason?: string;
}

/** Plain interface for a similarity edge between two videos. */
export interface ISimilarityEdge {
  videoIdA: string;
  videoIdB: string;
  score: number;
  scanId: string;
  createdAt: Date;
}

/** Plain interface for a similarity group document. */
export interface ISimilarityGroup {
  groupId: string;
  videoIds: string[];
  representativeVideoId: string;
  createdAt: Date;
  updatedAt: Date;
}
