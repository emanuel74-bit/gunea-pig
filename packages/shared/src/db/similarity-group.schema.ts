import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { randomUUID } from 'crypto';

export type SimilarityGroupHydratedDocument = HydratedDocument<SimilarityGroupDocument>;

/**
 * MongoDB schema for a similarity group.
 * A group is a connected component of videos whose pairwise scores
 * exceed the autoMergeGroupScore threshold.
 */
@Schema({ collection: 'similarity_groups', timestamps: true })
export class SimilarityGroupDocument {
  @Prop({ required: true, unique: true, index: true, default: () => randomUUID() })
  declare groupId: string;

  @Prop({ required: true, type: [String] })
  declare videoIds: string[];

  @Prop({ required: true })
  declare representativeVideoId: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const SimilarityGroupSchema = SchemaFactory.createForClass(SimilarityGroupDocument);

SimilarityGroupSchema.index({ videoIds: 1 });
