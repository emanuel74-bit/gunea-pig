import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { VideoDocument, VideoSchema, S3Adapter } from '@gunea-pig/shared';
import { VideoReadyConsumer } from './transport/video-ready.consumer';
import { StageVideoHandler } from './application/stage-video.handler';
import { VideoRepository } from './infrastructure/video.repository';
import { FileStagingAdapter } from './infrastructure/file-staging.adapter';
import { buildConfig } from './config';

const config = buildConfig();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(config.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    }),
    MongooseModule.forFeature([{ name: VideoDocument.name, schema: VideoSchema }]),
  ],
  controllers: [VideoReadyConsumer],
  providers: [
    StageVideoHandler,
    VideoRepository,
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
      provide: FileStagingAdapter,
      useFactory: (s3: S3Adapter) => new FileStagingAdapter(s3, config.stagingScanPath),
      inject: [S3Adapter],
    },
  ],
})
export class AppModule {}
