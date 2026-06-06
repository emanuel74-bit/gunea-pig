import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import { ScanStateRecord, ScanStateSchema } from '@vdf/shared-types';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { BatchClaimRepository } from '../infrastructure/batch-claim.repository';
import { ClaimOwnershipPolicy } from './claim-ownership.policy';
import { BatchClaimService } from './batch-claim.service';
import { BatchClaimScheduler } from './batch-claim.scheduler';
import { ScanExecutionModule } from '../scan-execution/scan-execution.module';
import { ResultPublicationModule } from '../result-publication/result-publication.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([{ name: ScanStateRecord.name, schema: ScanStateSchema }]),
    ScanExecutionModule,
    ResultPublicationModule,
  ],
  providers: [
    ScanStateRepository,
    BatchClaimRepository,
    ClaimOwnershipPolicy,
    BatchClaimService,
    BatchClaimScheduler,
  ],
})
export class BatchClaimModule {}
