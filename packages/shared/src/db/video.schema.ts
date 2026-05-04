import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ScanState, SimilarityStatus } from '../types/video.types';

export type VideoHydratedDocument = HydratedDocument<VideoDocument>;

/**
 * MongoDB schema for a video that participates in the similarity pipeline.
 * Indexed on videoId (unique), scanState, and scanClaimId for batch operations.
 */
@Schema({ collection: 'videos', timestamps: true })
export class VideoDocument {
  @Prop({ required: true, unique: true, index: true })
  declare videoId: string;

  @Prop({ required: true })
  declare s3Key: string;

  @Prop({ required: true })
  declare s3Bucket: string;

  @Prop({
    required: true,
    enum: Object.values(ScanState),
    default: ScanState.PENDING_STAGING,
    index: true,
  })
  declare scanState: ScanState;

  @Prop()
  stagedPath?: string;

  @Prop({ index: true, sparse: true })
  scanClaimId?: string;

  @Prop({ index: true, sparse: true })
  scanId?: string;

  @Prop()
  scanCompletedAt?: Date;

  @Prop({ index: true, sparse: true })
  similarityGroupId?: string;

  @Prop({
    enum: Object.values(SimilarityStatus),
    default: SimilarityStatus.UNPROCESSED,
  })
  similarityStatus?: SimilarityStatus;

  @Prop({ default: 0 })
  matchCount?: number;

  @Prop({ default: 0 })
  declare stagingAttempts: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const VideoSchema = SchemaFactory.createForClass(VideoDocument);

VideoSchema.index({ scanState: 1, updatedAt: 1 });
