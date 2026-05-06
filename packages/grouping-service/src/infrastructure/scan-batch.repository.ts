import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ScanBatchDocument, ScanBatchStatus } from '@gunea-pig/shared';

@Injectable()
export class ScanBatchRepository {
  constructor(
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
  ) {}

  async isAlreadyGrouped(scanId: string): Promise<boolean> {
    const batch = await this.scanBatchModel
      .findOne({
        scanId,
        status: {
          $in: [
            ScanBatchStatus.GROUPING_COMPLETED,
            ScanBatchStatus.PENDING_CLEANUP,
            ScanBatchStatus.CLEANUP_ALLOWED,
            ScanBatchStatus.CLEANED,
          ],
        },
      })
      .lean()
      .exec();
    return batch !== null;
  }

  async markGroupingCompleted(scanId: string): Promise<void> {
    await this.scanBatchModel.updateOne(
      { scanId },
      { $set: { status: ScanBatchStatus.GROUPING_COMPLETED, groupingConfirmedAt: new Date() } },
    );
  }
}
