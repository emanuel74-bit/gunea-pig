import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  ScanCompletedEvent,
  NormalizedScanResult,
  ScanResultMatch,
  QUEUE_EXCHANGES,
  ROUTING_KEYS,
  ScanPersistedEvent,
} from '@gunea-pig/shared';
import { SimilarityThreshold } from '../domain/similarity-threshold.policy';
import { UnionFindDomainService } from '../domain/union-find.domain-service';
import { PipelineConfig } from '../../config';
import { PIPELINE_CONFIG } from '../../injection-tokens';
import { IGroupingScanBatchRepository, I_GROUPING_SCAN_BATCH_REPOSITORY } from '../interfaces/i-scan-batch-repository.port';
import { IGroupingScanResultLoader, I_GROUPING_SCAN_RESULT_LOADER } from '../interfaces/i-scan-result-loader.port';
import { ISimilarityEdgeRepository, I_SIMILARITY_EDGE_REPOSITORY } from '../interfaces/i-similarity-edge-repository.port';
import { ISimilarityGroupRepository, GroupRecord, I_SIMILARITY_GROUP_REPOSITORY } from '../interfaces/i-similarity-group-repository.port';
import { IVideoSimilarityRepository, I_VIDEO_SIMILARITY_REPOSITORY } from '../interfaces/i-video-similarity-repository.port';
import { IEventPublisher, I_EVENT_PUBLISHER } from '../../shared-infra/interfaces/i-event-publisher.port';

export class ScanAlreadyGroupedError extends Error {
  constructor(public readonly scanId: string) {
    super(`Scan already grouped: scanId=${scanId}`);
    this.name = 'ScanAlreadyGroupedError';
  }
}

@Injectable()
export class ProcessScanHandler {
  private readonly logger = new Logger(ProcessScanHandler.name);
  private readonly unionFind = new UnionFindDomainService();

  constructor(
    @Inject(I_GROUPING_SCAN_RESULT_LOADER) private readonly scanResultClient: IGroupingScanResultLoader,
    @Inject(I_SIMILARITY_EDGE_REPOSITORY) private readonly edgeRepository: ISimilarityEdgeRepository,
    @Inject(I_SIMILARITY_GROUP_REPOSITORY) private readonly groupRepository: ISimilarityGroupRepository,
    @Inject(I_VIDEO_SIMILARITY_REPOSITORY) private readonly videoSimilarityRepository: IVideoSimilarityRepository,
    @Inject(I_GROUPING_SCAN_BATCH_REPOSITORY) private readonly scanBatchRepository: IGroupingScanBatchRepository,
    @Inject(I_EVENT_PUBLISHER) private readonly publisher: IEventPublisher,
    @Inject(PIPELINE_CONFIG)
    private readonly config: PipelineConfig,
  ) {}

  async handle(event: ScanCompletedEvent): Promise<void> {
    const { scanId, resultS3Key, resultS3Bucket, videoIds, correlationId } = event;

    const alreadyGrouped = await this.scanBatchRepository.isAlreadyGrouped(scanId);
    if (alreadyGrouped) {
      throw new ScanAlreadyGroupedError(scanId);
    }

    const scanResult = await this.scanResultClient.load(resultS3Bucket, resultS3Key);
    const threshold = new SimilarityThreshold(this.config.grouping.thresholdPolicy);

    const storableMatches = threshold.filterStorable(scanResult.matches);
    const mergeEligibleMatches = threshold.filterMergeEligible(storableMatches);

    await this.edgeRepository.persistEdges(scanResult, storableMatches);
    await this.applyGroupMerge(scanResult, mergeEligibleMatches);

    await this.scanBatchRepository.markGroupingCompleted(scanId);

    const persistedEvent: ScanPersistedEvent = {
      eventId: uuidv4(),
      schemaVersion: '1.0',
      scanId,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    await this.publisher.publish({
      exchange: QUEUE_EXCHANGES.SCAN_EVENTS,
      routingKey: ROUTING_KEYS.SCAN_PERSISTED,
      payload: persistedEvent as unknown as Record<string, unknown>,
      correlationId,
    });

    this.logger.log({ scanId, videoCount: videoIds.length }, 'Grouping completed and persisted');
  }

  private async applyGroupMerge(
    result: NormalizedScanResult,
    mergeEligible: ScanResultMatch[],
  ): Promise<void> {
    const components = this.unionFind.buildConnectedComponents(mergeEligible, result.videoIds);
    const touchedByEdge = new Set<string>();
    for (const m of mergeEligible) {
      touchedByEdge.add(m.videoIdA);
      touchedByEdge.add(m.videoIdB);
    }

    for (const component of components) {
      if (component.size > 1) {
        await this.mergeComponent([...component]);
      } else {
        const [videoId] = [...component];
        if (touchedByEdge.has(videoId)) {
          await this.videoSimilarityRepository.markHasMatches(videoId);
        }
      }
    }

    const untouched = result.videoIds.filter((id) => !touchedByEdge.has(id));
    await this.videoSimilarityRepository.markNoMatches(untouched);

    this.logger.log(
      { scanId: result.scanId, components: components.length, untouched: untouched.length },
      'Group merge applied',
    );
  }

  private async mergeComponent(videoIds: string[]): Promise<void> {
    const memberships = await this.videoSimilarityRepository.findGroupMemberships(videoIds);
    const existingGroupIds = [
      ...new Set(memberships.map((m) => m.similarityGroupId!).filter(Boolean)),
    ];

    let targetGroupId: string;
    let allVideoIds: string[] = [...videoIds];

    if (existingGroupIds.length > 0) {
      targetGroupId = existingGroupIds[0];
      const existingGroups = await this.groupRepository.findByIds(existingGroupIds);
      for (const g of existingGroups) allVideoIds.push(...g.videoIds);

      const toRemove = existingGroupIds.filter((id) => id !== targetGroupId);
      await this.groupRepository.deleteByIds(toRemove);
      await this.videoSimilarityRepository.reassignGroup(toRemove, targetGroupId);
    } else {
      targetGroupId = randomUUID();
    }

    allVideoIds = [...new Set(allVideoIds)];
    await this.groupRepository.upsertGroup(targetGroupId, allVideoIds);
    await this.videoSimilarityRepository.markInGroup(videoIds, targetGroupId);
  }
}
