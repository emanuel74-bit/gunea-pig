import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  VideoDocument,
  VideoSchema,
} from '@gunea-pig/shared';
import { StagingHandler } from './handlers/staging.handler';
import { VideoMongoService } from './services/video-mongo.service';
import { FileStagingService } from './services/file-staging.service';
import { S3Adapter } from '@gunea-pig/shared';
import { buildConfig } from './config';

const config = buildConfig();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(config.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    }),
    MongooseModule.forFeature([
      { name: VideoDocument.name, schema: VideoSchema },
    ]),
  ],
  controllers: [StagingHandler],
  providers: [
    VideoMongoService,
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
      provide: FileStagingService,
      useFactory: (s3: S3Adapter) => new FileStagingService(s3, config.stagingScanPath),
      inject: [S3Adapter],
    },
  ],
})
export class AppModule {}
