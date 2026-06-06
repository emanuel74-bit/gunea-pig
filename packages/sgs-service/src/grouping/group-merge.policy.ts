import { Injectable } from '@nestjs/common';
import { SimilarityThresholdConfig } from '@vdf/shared-types';

export enum GroupAction {
  MERGE_EXISTING = 'merge_existing',
  CREATE_NEW = 'create_new',
  MANUAL_REVIEW = 'manual_review',
  NO_GROUP = 'no_group',
}

@Injectable()
export class GroupMergePolicy {
  decide(similarityScore: number, thresholds: SimilarityThresholdConfig): GroupAction {
    if (similarityScore >= thresholds.autoMergeGroupScore) {
      return GroupAction.MERGE_EXISTING;
    }
    if (similarityScore >= thresholds.storeEdgeScore) {
      if (similarityScore < thresholds.requireManualReviewBelow) {
        return GroupAction.MANUAL_REVIEW;
      }
      return GroupAction.CREATE_NEW;
    }
    return GroupAction.NO_GROUP;
  }
}
