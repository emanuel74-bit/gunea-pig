import { SimilarityThresholdConfig } from '@vdf/shared-types';
import { GroupAction, GroupMergePolicy } from './group-merge.policy';

const thresholds: SimilarityThresholdConfig = {
  storeEdgeScore: 0.6,
  autoMergeGroupScore: 0.9,
  requireManualReviewBelow: 0.75,
  minSimilarityScore: 0.5,
};

describe('GroupMergePolicy', () => {
  let policy: GroupMergePolicy;

  beforeEach(() => {
    policy = new GroupMergePolicy();
  });

  it('returns MERGE_EXISTING when score >= autoMergeGroupScore', () => {
    expect(policy.decide(0.95, thresholds)).toBe(GroupAction.MERGE_EXISTING);
    expect(policy.decide(0.9, thresholds)).toBe(GroupAction.MERGE_EXISTING);
  });

  it('returns CREATE_NEW when score >= storeEdgeScore but >= requireManualReviewBelow and < autoMergeGroupScore', () => {
    expect(policy.decide(0.8, thresholds)).toBe(GroupAction.CREATE_NEW);
    expect(policy.decide(0.75, thresholds)).toBe(GroupAction.CREATE_NEW);
  });

  it('returns MANUAL_REVIEW when score < requireManualReviewBelow but >= storeEdgeScore', () => {
    expect(policy.decide(0.65, thresholds)).toBe(GroupAction.MANUAL_REVIEW);
    expect(policy.decide(0.6, thresholds)).toBe(GroupAction.MANUAL_REVIEW);
  });

  it('returns NO_GROUP when score < storeEdgeScore', () => {
    expect(policy.decide(0.5, thresholds)).toBe(GroupAction.NO_GROUP);
    expect(policy.decide(0.1, thresholds)).toBe(GroupAction.NO_GROUP);
  });
});
