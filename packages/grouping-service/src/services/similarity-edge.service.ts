import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SimilarityEdgeDocument,
  NormalizedScanResult,
  ScanResultMatch,
} from '@gunea-pig/shared';
import { GroupingConfig, GROUPING_CONFIG } from '../config';

/**
 * Repository role — persists similarity edges derived from a scan result.
 *
 * An edge is stored only if its score meets or exceeds storeEdgeScore.
 * Upserts are used to make all writes idempotent (same scanId + pair → same edge).
 */
@Injectable()
export class SimilarityEdgeService {
  private readonly logger = new Logger(SimilarityEdgeService.name);

  constructor(
    @InjectModel(SimilarityEdgeDocument.name)
    private readonly edgeModel: Model<SimilarityEdgeDocument>,
    @Inject(GROUPING_CONFIG)
    private readonly config: GroupingConfig,
  ) {}

  /**
   * Persists all edges from the scan result that meet the storeEdgeScore threshold.
   * Returns the subset of matches whose score also meets autoMergeGroupScore,
   * which the group-merge service uses to decide group membership.
   */
  async persistEdges(result: NormalizedScanResult): Promise<ScanResultMatch[]> {
    const { storeEdgeScore, autoMergeGroupScore } = this.config.thresholdPolicy;
    const mergeEligible: ScanResultMatch[] = [];

    const storableMatches = result.matches.filter((m) => m.score >= storeEdgeScore);

    for (const match of storableMatches) {
      // Canonical ordering: always store with lower videoId as A to avoid duplicates
      const [videoIdA, videoIdB] = [match.videoIdA, match.videoIdB].sort();

      await this.edgeModel.findOneAndUpdate(
        { videoIdA, videoIdB, scanId: result.scanId },
        {
          $setOnInsert: {
            videoIdA,
            videoIdB,
            score: match.score,
            scanId: result.scanId,
          },
        },
        { upsert: true },
      );

      if (match.score >= autoMergeGroupScore) {
        mergeEligible.push(match);
      }
    }

    this.logger.log(
      {
        scanId: result.scanId,
        stored: storableMatches.length,
        mergeEligible: mergeEligible.length,
      },
      'Similarity edges persisted',
    );

    return mergeEligible;
  }

  /**
   * Returns all edges for a given scanId — used for idempotency checks.
   */
  async edgesExistForScan(scanId: string): Promise<boolean> {
    const count = await this.edgeModel.countDocuments({ scanId });
    return count > 0;
  }
}
