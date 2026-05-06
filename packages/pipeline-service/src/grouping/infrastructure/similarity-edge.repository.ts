import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SimilarityEdgeDocument, ScanResultMatch, NormalizedScanResult } from '@gunea-pig/shared';

@Injectable()
export class SimilarityEdgeRepository {
  private readonly logger = new Logger(SimilarityEdgeRepository.name);

  constructor(
    @InjectModel(SimilarityEdgeDocument.name)
    private readonly edgeModel: Model<SimilarityEdgeDocument>,
  ) {}

  async persistEdges(result: NormalizedScanResult, storableMatches: ScanResultMatch[]): Promise<void> {
    for (const match of storableMatches) {
      const [videoIdA, videoIdB] = [match.videoIdA, match.videoIdB].sort();
      await this.edgeModel.findOneAndUpdate(
        { videoIdA, videoIdB, scanId: result.scanId },
        { $setOnInsert: { videoIdA, videoIdB, score: match.score, scanId: result.scanId } },
        { upsert: true },
      );
    }
    this.logger.log(
      { scanId: result.scanId, count: storableMatches.length },
      'Similarity edges persisted',
    );
  }

  async edgesExistForScan(scanId: string): Promise<boolean> {
    const count = await this.edgeModel.countDocuments({ scanId });
    return count > 0;
  }
}
