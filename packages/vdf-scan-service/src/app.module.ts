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
import { BatchClaimer } from './batch/batch-claimer';
import { VdfRunner } from './batch/vdf-runner';
import { Purger } from './batch/purger';
import { ManifestService } from './services/manifest.service';
import { ScanOrchestratorService } from './services/scan-orchestrator.service';
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
    // Config token — injected via @Inject(VDF_SCAN_CONFIG)
    { provide: VDF_SCAN_CONFIG, useValue: config },
    // Scan output dir — injected via @Inject(SCAN_OUTPUT_DIR)
    { provide: SCAN_OUTPUT_DIR, useValue: config.vdf.scanPath },
    BatchClaimer,
    VdfRunner,
    ManifestService,
    Purger,
    ScanOrchestratorService,
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
