import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SimilarityEdgeHydratedDocument = HydratedDocument<SimilarityEdgeDocument>;

/**
 * MongoDB schema for a similarity edge between two videos.
 * Edges below storeEdgeScore are never persisted.
 */
@Schema({ collection: 'similarity_edges', timestamps: true })
export class SimilarityEdgeDocument {
  @Prop({ required: true, index: true })
  declare videoIdA: string;

  @Prop({ required: true, index: true })
  declare videoIdB: string;

  @Prop({ required: true })
  declare score: number;

  @Prop({ required: true, index: true })
  declare scanId: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const SimilarityEdgeSchema = SchemaFactory.createForClass(SimilarityEdgeDocument);

// Unique constraint: one edge per pair per scan (idempotent upserts)
SimilarityEdgeSchema.index({ videoIdA: 1, videoIdB: 1, scanId: 1 }, { unique: true });
SimilarityEdgeSchema.index({ score: 1 });
