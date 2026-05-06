import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import {
  VideoDocument,
  VideoSchema,
  ScanBatchDocument,
  ScanBatchSchema,
  S3Adapter,
  RabbitMQPublisher,
} from '@gunea-pig/shared';
import { ScanOrchestrator } from './application/scan.orchestrator';
import { BatchClaimerService } from './infrastructure/batch-claimer.service';
import { VdfRunnerAdapter } from './infrastructure/vdf-runner.adapter';
import { ScanPurgerService } from './infrastructure/scan-purger.service';
import { VdfManifestNormalizer } from './infrastructure/vdf-manifest.normalizer';
import { VideoScanRepository } from './infrastructure/video-scan.repository';
import { buildConfig } from './config';
import { VDF_SCAN_CONFIG, SCAN_OUTPUT_DIR } from './injection-tokens';

const config = buildConfig();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(config.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    }),
    MongooseModule.forFeature([
      { name: VideoDocument.name, schema: VideoSchema },
      { name: ScanBatchDocument.name, schema: ScanBatchSchema },
    ]),
  ],
  providers: [
    { provide: VDF_SCAN_CONFIG, useValue: config },
    { provide: SCAN_OUTPUT_DIR, useValue: config.vdf.scanPath },
    VideoScanRepository,
    BatchClaimerService,
    VdfRunnerAdapter,
    VdfManifestNormalizer,
    ScanPurgerService,
    ScanOrchestrator,
    {
      provide: S3Adapter,
      useFactory: () =>
        new S3Adapter({
          endpoint: config.s3.endpoint,
          region: config.s3.region,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        }),
    },
    {
      provide: RabbitMQPublisher,
      useFactory: async () => {
        const publisher = new RabbitMQPublisher(config.rabbitmqUrl);
        await publisher.connect();
        return publisher;
      },
    },
  ],
})
export class AppModule {}
