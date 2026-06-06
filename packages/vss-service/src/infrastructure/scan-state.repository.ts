import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScanState, ScanStateDocument, ScanStateRecord } from '@vdf/shared-types';

@Injectable()
export class ScanStateRepository {
  constructor(
    @InjectModel(ScanStateRecord.name)
    private readonly model: Model<ScanStateDocument>,
  ) {}

  async findByVideoId(videoId: string): Promise<ScanStateRecord | null> {
    return this.model.findOne({ video_id: videoId }).lean().exec();
  }

  async upsertAwaitingStaging(videoId: string): Promise<ScanStateRecord> {
    const result = await this.model.findOneAndUpdate(
      { video_id: videoId },
      { $setOnInsert: { video_id: videoId, state: ScanState.AWAITING_STAGING, updated_at: new Date() } },
      { upsert: true, new: true },
    );
    return result!;
  }

  async transitionToStaged(videoId: string): Promise<ScanStateRecord | null> {
    return this.model.findOneAndUpdate(
      { video_id: videoId, state: ScanState.AWAITING_STAGING },
      { $set: { state: ScanState.STAGED, updated_at: new Date() } },
      { new: true },
    );
  }
}
