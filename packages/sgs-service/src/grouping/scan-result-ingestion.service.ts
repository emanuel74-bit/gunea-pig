import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NormalizedScanResult, ScanCompletedEvent, ScanState, SimilarityThresholdConfig } from '@vdf/shared-types';
import { ScanResultSchemaValidator } from './scan-result-schema.validator';
import { SimilarityEdgeFactory } from './similarity-edge.factory';
import { GroupMergePolicy, GroupAction } from './group-merge.policy';
import { S3ScanResultLoaderAdapter } from '../infrastructure/s3-scan-result-loader.adapter';
import { SimilarityEdgeRepository } from '../infrastructure/similarity-edge.repository';
import { SimilarityGroupRepository } from '../infrastructure/similarity-group.repository';
import { GroupingCompletionWriterAdapter } from '../infrastructure/grouping-completion-writer.adapter';

export type IngestionResult = 'ingested' | 'already_ingested' | 'schema_error';

@Injectable()
export class ScanResultIngestionService {
  private readonly logger = new Logger(ScanResultIngestionService.name);
  private readonly thresholds: SimilarityThresholdConfig;

  constructor(
    private readonly config: ConfigService,
    private readonly schemaValidator: ScanResultSchemaValidator,
    private readonly edgeFactory: SimilarityEdgeFactory,
    private readonly groupMergePolicy: GroupMergePolicy,
    private readonly s3Loader: S3ScanResultLoaderAdapter,
    private readonly edgeRepo: SimilarityEdgeRepository,
    private readonly groupRepo: SimilarityGroupRepository,
    private readonly completionWriter: GroupingCompletionWriterAdapter,
  ) {
    this.thresholds = {
      storeEdgeScore: this.config.get<number>('STORE_EDGE_SCORE_THRESHOLD')!,
      autoMergeGroupScore: this.config.get<number>('AUTO_MERGE_GROUP_SCORE')!,
      requireManualReviewBelow: this.config.get<number>('REQUIRE_MANUAL_REVIEW_BELOW')!,
      minSimilarityScore: this.config.get<number>('MIN_SIMILARITY_SCORE')!,
    };
  }

  async ingest(event: ScanCompletedEvent): Promise<IngestionResult> {
    const edges = await this.edgeRepo.findByScanId(event.scan_id);
    if (edges.length > 0) {
      this.logger.log(`Scan ${event.scan_id} already ingested — skipping`);
      return 'already_ingested';
    }

    let result: NormalizedScanResult;
    try {
      result = await this.s3Loader.load(event.result_location);
      this.schemaValidator.validate(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Schema validation failed for scan ${event.scan_id}: ${message}`);
      return 'schema_error';
    }

    const newEdges = this.edgeFactory.create(result, this.thresholds);

    for (const edge of newEdges) {
      await this.edgeRepo.upsertEdge(edge);

      const action = this.groupMergePolicy.decide(edge.similarity_score, this.thresholds);
      await this.applyGroupAction(action, edge.video_id_a, edge.video_id_b, event.scan_id);
    }

    await this.completionWriter.markGroupingComplete(event.scanned_video_ids);
    this.logger.log(`Ingested scan ${event.scan_id} — ${newEdges.length} edges processed`);
    return 'ingested';
  }

  private async applyGroupAction(
    action: GroupAction,
    videoIdA: string,
    videoIdB: string,
    scanId: string,
  ): Promise<void> {
    if (action === GroupAction.NO_GROUP || action === GroupAction.MANUAL_REVIEW) return;

    if (action === GroupAction.MERGE_EXISTING) {
      const existingGroup = await this.groupRepo.findByVideoId(videoIdA);
      if (existingGroup) {
        await this.groupRepo.mergeIntoGroup(existingGroup.group_id, [videoIdA, videoIdB], scanId);
        return;
      }
    }

    await this.groupRepo.createGroup([videoIdA, videoIdB], scanId);
  }
}
