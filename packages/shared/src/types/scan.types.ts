/**
 * Normalized VDF scan result schema.
 * Written to durable S3 storage by vdf-scan-service.
 * Loaded and validated by grouping-service.
 */

export interface ScanResultMatch {
  videoIdA: string;
  videoIdB: string;
  /** Similarity score normalized to [0.0, 1.0]. */
  score: number;
  /** Optional: VDF-reported match duration in seconds. */
  durationSec?: number;
}

export interface NormalizedScanResult {
  schemaVersion: '1.0';
  scanId: string;
  scannerVersion: string;
  scannerProfile: string;
  scannedAt: string; // ISO 8601
  videoIds: string[];
  matches: ScanResultMatch[];
}

/**
 * Similarity threshold policy.
 * Governs when edges are stored vs. when groups are auto-merged.
 */
export interface SimilarityThresholdPolicy {
  /** Minimum score to persist a similarity edge. */
  storeEdgeScore: number;
  /** Minimum score to automatically merge videos into a group. */
  autoMergeGroupScore: number;
  /** Score indicating strong duplicate; may bypass manual review. */
  strongDuplicateScore: number;
  /**
   * Videos with scores below this require manual review before merge.
   * Typically equals autoMergeGroupScore.
   */
  requireManualReviewBelow: number;
}
