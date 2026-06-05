/**
 * TC-CHAR-036: Assert SimilarityThresholdPolicy filterStorable and filterMergeEligible
 * Additional characterization test
 */
import { SimilarityThreshold } from '../../src/grouping/domain/similarity-threshold.policy';
import { ScanResultMatch } from '@gunea-pig/shared';

const policy = {
  storeEdgeScore: 0.88,
  autoMergeGroupScore: 0.93,
  strongDuplicateScore: 0.98,
  requireManualReviewBelow: 0.93,
};

const matches: ScanResultMatch[] = [
  { videoIdA: 'v1', videoIdB: 'v2', score: 0.95 },  // above both thresholds
  { videoIdA: 'v3', videoIdB: 'v4', score: 0.90 },  // above storeEdgeScore, below autoMerge
  { videoIdA: 'v5', videoIdB: 'v6', score: 0.85 },  // below both thresholds
];

describe('SimilarityThresholdPolicy contract (TC-CHAR-036)', () => {
  let threshold: SimilarityThreshold;

  beforeEach(() => {
    threshold = new SimilarityThreshold(policy);
  });

  it('filterStorable() returns matches with score >= storeEdgeScore (0.88)', () => {
    const result = threshold.filterStorable(matches);
    expect(result).toHaveLength(2);
    for (const m of result) {
      expect(m.score).toBeGreaterThanOrEqual(0.88);
    }
  });

  it('filterMergeEligible() returns matches with score >= autoMergeGroupScore (0.93)', () => {
    const result = threshold.filterMergeEligible(matches);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBeGreaterThanOrEqual(0.93);
  });

  it('Matches below storeEdgeScore threshold are excluded from filterStorable', () => {
    const result = threshold.filterStorable(matches);
    const hasBelow = result.some((m) => m.score < 0.88);
    expect(hasBelow).toBe(false);
  });

  it('Matches below autoMergeGroupScore are excluded from filterMergeEligible', () => {
    const result = threshold.filterMergeEligible(matches);
    const hasBelow = result.some((m) => m.score < 0.93);
    expect(hasBelow).toBe(false);
  });

  it('filterStorable() is a pure function — does not modify original array', () => {
    const original = [...matches];
    threshold.filterStorable(matches);
    expect(matches).toEqual(original);
  });

  it('filterMergeEligible() is a pure function — does not modify original array', () => {
    const original = [...matches];
    threshold.filterMergeEligible(matches);
    expect(matches).toEqual(original);
  });
});
