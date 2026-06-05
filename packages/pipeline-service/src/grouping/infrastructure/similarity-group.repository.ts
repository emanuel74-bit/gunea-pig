import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SimilarityGroupDocument } from '@gunea-pig/shared';
import { ISimilarityGroupRepository, GroupRecord } from '../interfaces/i-similarity-group-repository.port';

export { GroupRecord };

@Injectable()
export class SimilarityGroupRepository implements ISimilarityGroupRepository {
  private readonly logger = new Logger(SimilarityGroupRepository.name);

  constructor(
    @InjectModel(SimilarityGroupDocument.name)
    private readonly groupModel: Model<SimilarityGroupDocument>,
  ) {}

  async findByIds(groupIds: string[]): Promise<GroupRecord[]> {
    return this.groupModel
      .find({ groupId: { $in: groupIds } })
      .lean<GroupRecord[]>()
      .exec();
  }

  async upsertGroup(groupId: string, videoIds: string[]): Promise<void> {
    await this.groupModel.findOneAndUpdate(
      { groupId },
      { $set: { groupId, videoIds, representativeVideoId: videoIds[0] } },
      { upsert: true },
    );
    this.logger.log({ groupId, memberCount: videoIds.length }, 'Similarity group upserted');
  }

  async deleteByIds(groupIds: string[]): Promise<void> {
    if (groupIds.length === 0) return;
    await this.groupModel.deleteMany({ groupId: { $in: groupIds } });
    this.logger.log({ count: groupIds.length }, 'Stale groups removed');
  }
}
