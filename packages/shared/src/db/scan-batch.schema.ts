import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ScanBatchStatus } from '../types/video.types';

export type ScanBatchHydratedDocument = HydratedDocument<ScanBatchDocument>;

/**
 * MongoDB schema for a VDF scan batch claim.
 * Provides durable batch ownership — prevents concurrent workers from
 * processing the same videos (see: durable-batch-claiming requirement).
 */
@Schema({ collection: 'scan_batches', timestamps: true })
export class ScanBatchDocument {
  @Prop({ required: true, unique: true, index: true })
  declare scanId: string;

  @Prop({
    required: true,
    enum: Object.values(ScanBatchStatus),
    default: ScanBatchStatus.CLAIMED,
    index: true,
  })
  declare status: ScanBatchStatus;

  @Prop({ required: true, type: [String] })
  declare videoIds: string[];

  @Prop({ required: true })
  declare ownerId: string;

  @Prop({ required: true })
  declare claimedAt: Date;

  @Prop({ required: true, index: true })
  declare expiresAt: Date;

  @Prop()
  resultS3Key?: string;

  @Prop()
  resultS3Bucket?: string;

  @Prop()
  groupingConfirmedAt?: Date;

  @Prop()
  cleanedAt?: Date;

  @Prop({ default: 0 })
  declare retryCount: number;

  @Prop()
  failReason?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ScanBatchSchema = SchemaFactory.createForClass(ScanBatchDocument);

ScanBatchSchema.index({ status: 1, expiresAt: 1 });
ScanBatchSchema.index({ ownerId: 1, status: 1 });
