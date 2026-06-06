import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScanStateRecord, ScanStateSchema } from '@vdf/shared-types';
import { RabbitMqModule } from '../infrastructure/rabbitmq/rabbitmq.module';
import { S3ScanResultLoaderAdapter } from '../infrastructure/s3-scan-result-loader.adapter';
import { SimilarityEdgeRepository } from '../infrastructure/similarity-edge.repository';
import { SimilarityGroupRepository } from '../infrastructure/similarity-group.repository';
import { GroupingCompletionWriterAdapter } from '../infrastructure/grouping-completion-writer.adapter';
import { ScanResultSchemaValidator } from './scan-result-schema.validator';
import { SimilarityEdgeFactory } from './similarity-edge.factory';
import { GroupMergePolicy } from './group-merge.policy';
import { ScanResultIngestionService } from './scan-result-ingestion.service';
import { ScanCompletedConsumer } from './scan-completed.consumer';

@Module({
  imports: [
    RabbitMqModule,
    MongooseModule.forFeature([{ name: ScanStateRecord.name, schema: ScanStateSchema }]),
  ],
  providers: [
    S3ScanResultLoaderAdapter,
    SimilarityEdgeRepository,
    SimilarityGroupRepository,
    GroupingCompletionWriterAdapter,
    ScanResultSchemaValidator,
    SimilarityEdgeFactory,
    GroupMergePolicy,
    ScanResultIngestionService,
    ScanCompletedConsumer,
  ],
})
export class GroupingModule {}
