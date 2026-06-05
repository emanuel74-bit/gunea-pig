import { NormalizedScanResult, ScanResultMatch } from '@gunea-pig/shared';

export const I_SIMILARITY_EDGE_REPOSITORY = Symbol('ISimilarityEdgeRepository');

export interface ISimilarityEdgeRepository {
  persistEdges(result: NormalizedScanResult, storableMatches: ScanResultMatch[]): Promise<void>;
}
