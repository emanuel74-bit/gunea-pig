import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoDocument, VideoSchema, ScanBatchDocument, ScanBatchSchema } from '@gunea-pig/shared';
import { ScanOrchestrator } from './application/scan.orchestrator';
import { BatchClaimerService } from './infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from './infrastructure/vdf-runner.adapter';
import { VdfManifestNormalizer } from './infrastructure/vdf-manifest.normalizer';
import { ScanPurgerService } from './infrastructure/scan-purger.service';
import { VideoScanRepository } from './infrastructure/video-scan.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoDocument.name, schema: VideoSchema },
      { name: ScanBatchDocument.name, schema: ScanBatchSchema },
    ]),
  ],
  providers: [
    VideoScanRepository,
    BatchClaimerService,
    VdfRunnerAdapter,
    VdfManifestNormalizer,
    ScanPurgerService,
    ScanOrchestrator,
  ],
})
export class ScanningModule {}
