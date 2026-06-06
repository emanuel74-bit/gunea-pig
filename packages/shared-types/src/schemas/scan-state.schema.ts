import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ScanState } from '../enums/scan-state.enum';

export type ScanStateDocument = HydratedDocument<ScanStateRecord>;

@Schema({ collection: 'scan_states', timestamps: false })
export class ScanStateRecord {
  @Prop({ required: true, unique: true, index: true })
  video_id: string;

  @Prop({ required: true, enum: Object.values(ScanState), default: ScanState.AWAITING_STAGING })
  state: ScanState;

  @Prop({ required: true, default: () => new Date() })
  updated_at: Date;

  @Prop()
  batch_claim_id?: string;

  @Prop()
  scan_id?: string;

  @Prop()
  result_s3_key?: string;

  @Prop()
  error_message?: string;

  @Prop()
  claimed_at?: Date;

  @Prop()
  scanned_at?: Date;
}

export const ScanStateSchema = SchemaFactory.createForClass(ScanStateRecord);
