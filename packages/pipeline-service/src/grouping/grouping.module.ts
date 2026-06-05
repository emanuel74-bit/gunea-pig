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
import {
  I_GROUPING_SCAN_BATCH_REPOSITORY,
  I_SIMILARITY_EDGE_REPOSITORY,
  I_SIMILARITY_GROUP_REPOSITORY,
  I_VIDEO_SIMILARITY_REPOSITORY,
  I_GROUPING_SCAN_RESULT_LOADER,
} from '../injection-tokens';

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
    { provide: I_GROUPING_SCAN_RESULT_LOADER, useClass: ScanResultClient },
    SimilarityEdgeRepository,
    { provide: I_SIMILARITY_EDGE_REPOSITORY, useClass: SimilarityEdgeRepository },
    SimilarityGroupRepository,
    { provide: I_SIMILARITY_GROUP_REPOSITORY, useClass: SimilarityGroupRepository },
    VideoSimilarityRepository,
    { provide: I_VIDEO_SIMILARITY_REPOSITORY, useClass: VideoSimilarityRepository },
    ScanBatchRepository,
    { provide: I_GROUPING_SCAN_BATCH_REPOSITORY, useClass: ScanBatchRepository },
  ],
})
export class GroupingModule {}
