import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  VideoDocument,
  VideoSchema,
  ScanBatchDocument,
  ScanBatchSchema,
  SimilarityEdgeDocument,
  SimilarityEdgeSchema,
  SimilarityGroupDocument,
  SimilarityGroupSchema,
} from '@gunea-pig/shared';
import { ScanCompletedConsumer } from './transport/scan-completed.consumer';
import { ProcessScanHandler } from './application/process-scan.handler';
import { ScanResultClient } from './infrastructure/scan-result.client';
import { SimilarityEdgeRepository } from './infrastructure/similarity-edge.repository';
import { SimilarityGroupRepository } from './infrastructure/similarity-group.repository';
import { VideoSimilarityRepository } from './infrastructure/video-similarity.repository';
import { ScanBatchRepository } from './infrastructure/scan-batch.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoDocument.name, schema: VideoSchema },
      { name: ScanBatchDocument.name, schema: ScanBatchSchema },
      { name: SimilarityEdgeDocument.name, schema: SimilarityEdgeSchema },
      { name: SimilarityGroupDocument.name, schema: SimilarityGroupSchema },
    ]),
  ],
  controllers: [ScanCompletedConsumer],
  providers: [
    ProcessScanHandler,
    ScanResultClient,
    SimilarityEdgeRepository,
    SimilarityGroupRepository,
    VideoSimilarityRepository,
    ScanBatchRepository,
  ],
})
export class GroupingModule {}
