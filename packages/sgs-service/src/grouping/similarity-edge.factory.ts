import { Injectable } from '@nestjs/common';
import { NormalizedScanResult, SimilarityThresholdConfig } from '@vdf/shared-types';
import type { SimilarityEdge } from '../infrastructure/similarity-edge.repository';

@Injectable()
export class SimilarityEdgeFactory {
  create(
    result: NormalizedScanResult,
    thresholds: SimilarityThresholdConfig,
  ): Omit<SimilarityEdge, 'created_at'>[] {
    return result.video_pairs
      .filter((pair) => pair.similarity_score >= thresholds.storeEdgeScore)
      .map((pair) => {
        const [a, b] = [pair.video_id_a, pair.video_id_b].sort();
        return {
          scan_id: result.scan_id,
          video_pair_key: `${a}::${b}`,
          video_id_a: a,
          video_id_b: b,
          similarity_score: pair.similarity_score,
        };
      });
  }
}
