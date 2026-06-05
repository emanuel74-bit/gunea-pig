import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideoDocument, VideoSchema, S3Adapter } from '@gunea-pig/shared';
import { VideoReadyConsumer } from './transport/video-ready.consumer';
import { StageVideoHandler } from './application/stage-video.handler';
import { VideoRepository } from './infrastructure/video.repository';
import { FileStagingAdapter } from './infrastructure/file-staging.adapter';
import { PIPELINE_CONFIG, I_VIDEO_REPOSITORY, I_FILE_STAGING } from '../injection-tokens';
import { PipelineConfig } from '../config';

@Module({
  imports: [MongooseModule.forFeature([{ name: VideoDocument.name, schema: VideoSchema }])],
  controllers: [VideoReadyConsumer],
  providers: [
    StageVideoHandler,
    { provide: I_VIDEO_REPOSITORY, useClass: VideoRepository },
    VideoRepository,
    {
      provide: I_FILE_STAGING,
      useFactory: (s3: S3Adapter, config: PipelineConfig) =>
        new FileStagingAdapter(s3, config.staging.scanPath),
      inject: [S3Adapter, PIPELINE_CONFIG],
    },
  ],
})
export class StagingModule {}
