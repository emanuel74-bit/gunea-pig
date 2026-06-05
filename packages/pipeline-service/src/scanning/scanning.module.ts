import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoDocument, VideoSchema, ScanBatchDocument, ScanBatchSchema } from '@gunea-pig/shared';
import { ScanOrchestrator } from './application/scan.orchestrator';
import { ScanSchedulerTrigger } from './application/scan-scheduler.scheduler';
import { BatchClaimerService } from './infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from './infrastructure/vdf-runner.adapter';
import { VdfManifestNormalizer } from './infrastructure/vdf-manifest.normalizer';
import { ScanPurgerService } from './infrastructure/scan-purger.service';
import { VideoScanRepository } from './infrastructure/video-scan.repository';
import { I_BATCH_CLAIMER, I_VDF_RUNNER, I_VIDEO_SCAN_REPOSITORY } from '../injection-tokens';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoDocument.name, schema: VideoSchema },
      { name: ScanBatchDocument.name, schema: ScanBatchSchema },
    ]),
  ],
  providers: [
    VideoScanRepository,
    { provide: I_VIDEO_SCAN_REPOSITORY, useClass: VideoScanRepository },
    BatchClaimerService,
    { provide: I_BATCH_CLAIMER, useClass: BatchClaimerService },
    VdfRunnerAdapter,
    { provide: I_VDF_RUNNER, useClass: VdfRunnerAdapter },
    VdfManifestNormalizer,
    ScanPurgerService,
    ScanOrchestrator,
    ScanSchedulerTrigger,
  ],
})
export class ScanningModule {}
