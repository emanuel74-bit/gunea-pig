import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import {
  VideoDocument,
  VideoSchema,
  ScanBatchDocument,
  ScanBatchSchema,
  SimilarityEdgeDocument,
  SimilarityEdgeSchema,
  SimilarityGroupDocument,
  SimilarityGroupSchema,
  S3Adapter,
  RabbitMQPublisher,
} from '@gunea-pig/shared';
import { ScanCompletedConsumer } from './consumers/scan-completed.consumer';
import { ScanResultLoaderService } from './services/scan-result-loader.service';
import { SimilarityEdgeService } from './services/similarity-edge.service';
import { GroupMergeService } from './services/group-merge.service';
import { buildConfig, GROUPING_CONFIG } from './config';

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
      { name: ScanBatchDocument.name, schema: ScanBatchSchema },
      { name: SimilarityEdgeDocument.name, schema: SimilarityEdgeSchema },
      { name: SimilarityGroupDocument.name, schema: SimilarityGroupSchema },
    ]),
  ],
  controllers: [ScanCompletedConsumer],
  providers: [
    { provide: GROUPING_CONFIG, useValue: config },
    ScanResultLoaderService,
    SimilarityEdgeService,
    GroupMergeService,
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
