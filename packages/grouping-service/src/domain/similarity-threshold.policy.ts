import { ScanResultMatch, SimilarityThresholdPolicy } from '@gunea-pig/shared';

export class SimilarityThreshold {
  constructor(private readonly policy: SimilarityThresholdPolicy) {}

  isStorable(match: ScanResultMatch): boolean {
    return match.score >= this.policy.storeEdgeScore;
  }

  isMergeEligible(match: ScanResultMatch): boolean {
    return match.score >= this.policy.autoMergeGroupScore;
  }

  isStrongDuplicate(match: ScanResultMatch): boolean {
    return match.score >= this.policy.strongDuplicateScore;
  }

  requiresManualReview(match: ScanResultMatch): boolean {
    return match.score < this.policy.requireManualReviewBelow;
  }

  filterStorable(matches: ScanResultMatch[]): ScanResultMatch[] {
    return matches.filter((m) => this.isStorable(m));
  }

  filterMergeEligible(matches: ScanResultMatch[]): ScanResultMatch[] {
    return matches.filter((m) => this.isMergeEligible(m));
  }
}
