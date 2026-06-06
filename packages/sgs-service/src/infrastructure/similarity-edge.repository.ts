import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export interface SimilarityEdge {
  scan_id: string;
  video_pair_key: string;
  video_id_a: string;
  video_id_b: string;
  similarity_score: number;
  created_at: Date;
}

@Injectable()
export class SimilarityEdgeRepository {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private get collection() {
    return this.connection.collection('similarity_edges');
  }

  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { scan_id: 1, video_pair_key: 1 },
      { unique: true },
    );
  }

  async upsertEdge(edge: Omit<SimilarityEdge, 'created_at'>): Promise<void> {
    await this.collection.updateOne(
      { scan_id: edge.scan_id, video_pair_key: edge.video_pair_key },
      { $setOnInsert: { ...edge, created_at: new Date() } },
      { upsert: true },
    );
  }

  async findByScanId(scanId: string): Promise<SimilarityEdge[]> {
    return this.collection.find<SimilarityEdge>({ scan_id: scanId }).toArray();
  }
}
