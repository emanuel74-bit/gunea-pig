import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoDocument, SimilarityStatus } from '@gunea-pig/shared';

export interface VideoGroupMembership {
  videoId: string;
  similarityGroupId?: string;
}

@Injectable()
export class VideoSimilarityRepository {
  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
  ) {}

  async findGroupMemberships(videoIds: string[]): Promise<VideoGroupMembership[]> {
    return this.videoModel
      .find({ videoId: { $in: videoIds }, similarityGroupId: { $exists: true, $ne: null } })
      .select('videoId similarityGroupId')
      .lean<VideoGroupMembership[]>()
      .exec();
  }

  async reassignGroup(fromGroupIds: string[], toGroupId: string): Promise<void> {
    if (fromGroupIds.length === 0) return;
    await this.videoModel.updateMany(
      { similarityGroupId: { $in: fromGroupIds } },
      { $set: { similarityGroupId: toGroupId } },
    );
  }

  async markInGroup(videoIds: string[], groupId: string): Promise<void> {
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      {
        $set: {
          similarityGroupId: groupId,
          similarityStatus: SimilarityStatus.IN_GROUP,
          matchCount: videoIds.length - 1,
        },
      },
    );
  }

  async markHasMatches(videoId: string): Promise<void> {
    await this.videoModel.updateOne(
      { videoId },
      { $set: { similarityStatus: SimilarityStatus.HAS_MATCHES } },
    );
  }

  async markNoMatches(videoIds: string[]): Promise<void> {
    if (videoIds.length === 0) return;
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      { $set: { similarityStatus: SimilarityStatus.NO_MATCHES, matchCount: 0 } },
    );
  }
}
