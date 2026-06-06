import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

export interface SimilarityGroup {
  group_id: string;
  video_ids: string[];
  scan_ids: string[];
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SimilarityGroupRepository {
  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  private get collection() {
    return this.connection.collection('similarity_groups');
  }

  async createGroup(videoIds: string[], scanId: string): Promise<string> {
    const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    await this.collection.insertOne({
      group_id: groupId,
      video_ids: videoIds,
      scan_ids: [scanId],
      created_at: now,
      updated_at: now,
    });
    return groupId;
  }

  async mergeIntoGroup(groupId: string, videoIds: string[], scanId: string): Promise<void> {
    await this.collection.updateOne(
      { group_id: groupId },
      {
        $addToSet: { video_ids: { $each: videoIds }, scan_ids: scanId },
        $set: { updated_at: new Date() },
      },
    );
  }

  async findByVideoId(videoId: string): Promise<SimilarityGroup | null> {
    return this.collection.findOne<SimilarityGroup>({ video_ids: videoId });
  }
}
