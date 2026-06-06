import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScanState, ScanStateDocument, ScanStateRecord } from '@vdf/shared-types';

@Injectable()
export class GroupingCompletionWriterAdapter {
  constructor(
    @InjectModel(ScanStateRecord.name)
    private readonly model: Model<ScanStateDocument>,
  ) {}

  async markGroupingComplete(videoIds: string[]): Promise<void> {
    await this.model.updateMany(
      { video_id: { $in: videoIds }, state: ScanState.SCAN_COMPLETE },
      { $set: { state: ScanState.GROUPING_COMPLETE, updated_at: new Date() } },
    );
  }
}
