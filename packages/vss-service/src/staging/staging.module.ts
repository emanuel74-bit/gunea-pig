import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScanStateRecord, ScanStateSchema } from '@vdf/shared-types';
import { RabbitMqModule } from '../infrastructure/rabbitmq/rabbitmq.module';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { VideoMetadataRepository } from '../infrastructure/video-metadata.repository';
import { S3VideoDownloaderAdapter } from '../infrastructure/s3-video-downloader.adapter';
import { FilesystemStagingWriterAdapter } from '../infrastructure/filesystem-staging-writer.adapter';
import { StagingIdempotencyPolicy } from './staging-idempotency.policy';
import { StagingService } from './staging.service';
import { NewVideoConsumer } from './new-video.consumer';

@Module({
  imports: [
    RabbitMqModule,
    MongooseModule.forFeature([{ name: ScanStateRecord.name, schema: ScanStateSchema }]),
  ],
  providers: [
    ScanStateRepository,
    VideoMetadataRepository,
    S3VideoDownloaderAdapter,
    FilesystemStagingWriterAdapter,
    StagingIdempotencyPolicy,
    StagingService,
    NewVideoConsumer,
  ],
})
export class StagingModule {}
