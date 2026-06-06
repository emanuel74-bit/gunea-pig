import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScanStateRecord, ScanStateSchema } from '@vdf/shared-types';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { CleanupService } from './cleanup.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ScanStateRecord.name, schema: ScanStateSchema }]),
  ],
  providers: [ScanStateRepository, CleanupService],
  exports: [CleanupService],
})
export class CleanupModule {}
