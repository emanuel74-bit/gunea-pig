import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  VideoDocument,
  SimilarityGroupDocument,
  ScanResultMatch,
  SimilarityStatus,
  NormalizedScanResult,
} from '@gunea-pig/shared';
import { GroupingConfig, GROUPING_CONFIG } from '../config';

/**
 * Service role — merges videos into similarity groups using a Union-Find
 * (disjoint-set) strategy over the merge-eligible edges.
 *
 * Responsibilities:
 * - Groups merge-eligible matches into connected components.
 * - For each component, merges into an existing group or creates a new one.
 * - Updates every affected video document with similarity status and group ID.
 * - Handles videos with no matches (zero-match case).
 * - All writes are idempotent.
 *
 * Must not run VDF.
 * Must not copy files from S3.
 * Must not depend on VDF internal state.
 */
@Injectable()
export class GroupMergeService {
  private readonly logger = new Logger(GroupMergeService.name);

  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(SimilarityGroupDocument.name)
    private readonly groupModel: Model<SimilarityGroupDocument>,
    @Inject(GROUPING_CONFIG)
    private readonly config: GroupingConfig,
  ) {}

  /**
   * Main entry point for group merging after edges have been persisted.
   * - mergeEligibleMatches: edges that meet autoMergeGroupScore.
   * - allVideoIds: every video in the scan batch (including those with no matches).
   */
  async mergeGroups(
    result: NormalizedScanResult,
    mergeEligibleMatches: ScanResultMatch[],
  ): Promise<void> {
    const allVideoIds = result.videoIds;

    // Build connected components from merge-eligible edges (Union-Find)
    const components = this.buildConnectedComponents(mergeEligibleMatches, allVideoIds);

    for (const component of components) {
      if (component.size === 1) {
        // Single video — no group membership, mark as no_matches or has_matches
        const [videoId] = [...component];
        const hasEdge = mergeEligibleMatches.some(
          (m) => m.videoIdA === videoId || m.videoIdB === videoId,
        );
        await this.markVideoNoGroup(videoId, hasEdge);
      } else {
        await this.mergeComponent([...component]);
      }
    }

    // Mark any unmatched videos (not in merge-eligible pairs at all)
    const touchedVideoIds = new Set<string>();
    for (const m of mergeEligibleMatches) {
      touchedVideoIds.add(m.videoIdA);
      touchedVideoIds.add(m.videoIdB);
    }

    for (const videoId of allVideoIds) {
      if (!touchedVideoIds.has(videoId)) {
        await this.markVideoScannedZeroMatches(videoId);
      }
    }

    this.logger.log(
      { scanId: result.scanId, componentCount: components.length },
      'Group merge complete',
    );
  }

  /**
   * Builds connected components using an iterative Union-Find approach.
   * Returns a set of video ID sets, one per component.
   */
  private buildConnectedComponents(
    edges: ScanResultMatch[],
    allVideoIds: string[],
  ): Set<string>[] {
    const parent = new Map<string, string>();

    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }
      return parent.get(id)!;
    };

    const union = (a: string, b: string): void => {
      parent.set(find(a), find(b));
    };

    // Initialize all known videos
    for (const id of allVideoIds) find(id);

    // Union connected pairs
    for (const { videoIdA, videoIdB } of edges) {
      union(videoIdA, videoIdB);
    }

    // Group by root
    const groups = new Map<string, Set<string>>();
    for (const id of allVideoIds) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(id);
    }

    return [...groups.values()];
  }

  /**
   * Merges a component of >1 videos into an existing or new similarity group.
   * If any video in the component already belongs to a group, that group absorbs all others.
   */
  private async mergeComponent(videoIds: string[]): Promise<void> {
    // Find existing group memberships
    const existingDocs = await this.videoModel
      .find({ videoId: { $in: videoIds }, similarityGroupId: { $exists: true, $ne: null } })
      .select('videoId similarityGroupId')
      .lean<{ videoId: string; similarityGroupId?: string }[]>()
      .exec();

    const existingGroupIds = [...new Set(existingDocs.map((d) => d.similarityGroupId!).filter(Boolean))];

    let targetGroupId: string;
    let groupVideoIds: string[] = [...videoIds];

    if (existingGroupIds.length > 0) {
      // Use the first existing group as the merge target
      targetGroupId = existingGroupIds[0];

      // Collect all members of all existing groups to merge
      const existingGroups = await this.groupModel
        .find({ groupId: { $in: existingGroupIds } })
        .lean<{ groupId: string; videoIds: string[] }[]>()
        .exec();

      for (const g of existingGroups) {
        groupVideoIds.push(...g.videoIds);
      }

      // Remove merged sub-groups (keep the target group)
      const groupsToRemove = existingGroupIds.filter((id) => id !== targetGroupId);
      if (groupsToRemove.length > 0) {
        await this.groupModel.deleteMany({ groupId: { $in: groupsToRemove } });
        // Re-point orphaned video references to the target group
        await this.videoModel.updateMany(
          { similarityGroupId: { $in: groupsToRemove } },
          { $set: { similarityGroupId: targetGroupId } },
        );
      }
    } else {
      targetGroupId = randomUUID();
    }

    // Deduplicate member list
    groupVideoIds = [...new Set(groupVideoIds)];
    const representativeVideoId = groupVideoIds[0];

    // Upsert the target group
    await this.groupModel.findOneAndUpdate(
      { groupId: targetGroupId },
      {
        $set: {
          groupId: targetGroupId,
          videoIds: groupVideoIds,
          representativeVideoId,
        },
      },
      { upsert: true },
    );

    // Update each video's similarity info
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      {
        $set: {
          similarityGroupId: targetGroupId,
          similarityStatus: SimilarityStatus.IN_GROUP,
          matchCount: videoIds.length - 1,
        },
      },
    );
  }

  private async markVideoNoGroup(videoId: string, hasEdgeMatch: boolean): Promise<void> {
    const status = hasEdgeMatch ? SimilarityStatus.HAS_MATCHES : SimilarityStatus.NO_MATCHES;
    await this.videoModel.updateOne(
      { videoId },
      { $set: { similarityStatus: status } },
    );
  }

  private async markVideoScannedZeroMatches(videoId: string): Promise<void> {
    await this.videoModel.updateOne(
      { videoId },
      { $set: { similarityStatus: SimilarityStatus.NO_MATCHES, matchCount: 0 } },
    );
  }
}
