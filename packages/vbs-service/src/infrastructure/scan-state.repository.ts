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

  async findStagedBatch(limit: number): Promise<ScanStateRecord[]> {
    return this.model.find({ state: ScanState.STAGED }).limit(limit).lean().exec();
  }

  async findByVideoId(videoId: string): Promise<ScanStateRecord | null> {
    return this.model.findOne({ video_id: videoId }).lean().exec();
  }

  async transitionToClaimed(videoId: string, batchClaimId: string): Promise<ScanStateRecord | null> {
    return this.model.findOneAndUpdate(
      { video_id: videoId, state: ScanState.STAGED },
      { $set: { state: ScanState.CLAIMED, batch_claim_id: batchClaimId, claimed_at: new Date(), updated_at: new Date() } },
      { new: true },
    );
  }

  async transitionToScanning(videoId: string, batchClaimId: string): Promise<ScanStateRecord | null> {
    return this.model.findOneAndUpdate(
      { video_id: videoId, state: ScanState.CLAIMED, batch_claim_id: batchClaimId },
      { $set: { state: ScanState.SCANNING, updated_at: new Date() } },
      { new: true },
    );
  }

  async transitionToScanComplete(videoId: string, scanId: string, resultS3Key: string): Promise<ScanStateRecord | null> {
    return this.model.findOneAndUpdate(
      { video_id: videoId, state: ScanState.SCANNING },
      { $set: { state: ScanState.SCAN_COMPLETE, scan_id: scanId, result_s3_key: resultS3Key, scanned_at: new Date(), updated_at: new Date() } },
      { new: true },
    );
  }

  async transitionToFailed(videoId: string, errorMessage: string): Promise<void> {
    await this.model.findOneAndUpdate(
      { video_id: videoId },
      { $set: { state: ScanState.FAILED, error_message: errorMessage, updated_at: new Date() } },
    );
  }

  async findCleanupAllowed(limit: number): Promise<ScanStateRecord[]> {
    return this.model.find({ state: ScanState.CLEANUP_ALLOWED }).limit(limit).lean().exec();
  }

  async transitionToCleaned(videoId: string): Promise<void> {
    await this.model.findOneAndUpdate(
      { video_id: videoId, state: ScanState.CLEANUP_ALLOWED },
      { $set: { state: ScanState.CLEANED, updated_at: new Date() } },
    );
  }
}
