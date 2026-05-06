import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { VideoDocument, ScanState } from '@gunea-pig/shared';
import * as path from 'path';

@Injectable()
export class VideoScanRepository {
  constructor(
    @InjectModel(VideoDocument.name)
    private readonly videoModel: Model<VideoDocument>,
  ) {}

  async markScanClaimed(videoIds: string[], scanId: string): Promise<void> {
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      { $set: { scanState: ScanState.SCAN_CLAIMED, scanClaimId: scanId } },
    );
  }

  async markScanCompleted(videoIds: string[], scanId: string): Promise<void> {
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      { $set: { scanState: ScanState.SCAN_COMPLETED, scanId } },
    );
  }

  async markScanFailed(videoIds: string[]): Promise<void> {
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds } },
      { $set: { scanState: ScanState.SCAN_FAILED } },
    );
  }

  async markGroupingCompleted(videoIds: string[]): Promise<void> {
    await this.videoModel.updateMany(
      { videoId: { $in: videoIds }, scanState: ScanState.SCAN_COMPLETED },
      { $set: { scanState: ScanState.GROUPING_COMPLETED } },
    );
  }

  async buildVideoIdMap(videoIds: string[]): Promise<Record<string, string>> {
    const docs = await this.videoModel
      .find({ videoId: { $in: videoIds } })
      .select('videoId stagedPath')
      .lean<{ videoId: string; stagedPath?: string }[]>()
      .exec();

    const map: Record<string, string> = {};
    for (const doc of docs) {
      if (doc.stagedPath) {
        const stem = path.basename(doc.stagedPath, path.extname(doc.stagedPath));
        map[stem] = doc.videoId;
      }
      map[doc.videoId] = doc.videoId;
    }
    return map;
  }
}
