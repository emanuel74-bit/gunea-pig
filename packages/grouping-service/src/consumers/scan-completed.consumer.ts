import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  ScanCompletedEvent,
  ScanBatchDocument,
  ScanBatchStatus,
  RabbitMQPublisher,
  QUEUE_EXCHANGES,
  ROUTING_KEYS,
  ScanPersistedEvent,
} from '@gunea-pig/shared';
import { ScanResultLoaderService } from '../services/scan-result-loader.service';
import { SimilarityEdgeService } from '../services/similarity-edge.service';
import { GroupMergeService } from '../services/group-merge.service';
import { ScanResultValidationError } from '../validators/scan-result.validator';

/**
 * Consumer role — transport entry point for ScanCompletedEvent messages.
 *
 * Responsibilities:
 * - Validates the inbound event at the boundary.
 * - Enforces idempotency: skips if the scan has already been grouped.
 * - Loads the scan result from durable S3 storage.
 * - Delegates edge persistence and group merging.
 * - Publishes ScanPersistedEvent to allow vdf-scan-service cleanup.
 * - ACKs or NACKs the RabbitMQ message appropriately.
 *
 * Must not run VDF.
 * Must not copy video files from S3.
 */
@Controller()
export class ScanCompletedConsumer {
  private readonly logger = new Logger(ScanCompletedConsumer.name);

  constructor(
    @InjectModel(ScanBatchDocument.name)
    private readonly scanBatchModel: Model<ScanBatchDocument>,
    private readonly scanResultLoader: ScanResultLoaderService,
    private readonly edgeService: SimilarityEdgeService,
    private readonly groupMergeService: GroupMergeService,
    private readonly publisher: RabbitMQPublisher,
  ) {}

  @EventPattern('scan.completed')
  async handleScanCompleted(
    @Payload() rawPayload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as {
      ack: (msg: unknown) => void;
      nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    const originalMsg = context.getMessage();

    // Boundary validation
    let event: ScanCompletedEvent;
    try {
      event = this.validateEvent(rawPayload);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Event validation failed: ${error.message}`);
      channel.nack(originalMsg, false, false);
      return;
    }

    const { scanId, resultS3Key, resultS3Bucket, videoIds, correlationId } = event;

    this.logger.log({ scanId, correlationId }, 'Received ScanCompletedEvent');

    try {
      // Idempotency: skip if already processed
      const alreadyGrouped = await this.isScanAlreadyGrouped(scanId);
      if (alreadyGrouped) {
        this.logger.log({ scanId }, 'Scan already grouped — skipping (idempotent)');
        channel.ack(originalMsg);
        return;
      }

      // Load + validate normalized scan result from durable S3 storage
      const scanResult = await this.scanResultLoader.load(resultS3Bucket, resultS3Key);

      // Persist similarity edges (threshold-filtered)
      const mergeEligibleMatches = await this.edgeService.persistEdges(scanResult);

      // Merge similarity groups
      await this.groupMergeService.mergeGroups(scanResult, mergeEligibleMatches);

      // Mark batch as grouping_completed in MongoDB (cleanup gate)
      await this.scanBatchModel.updateOne(
        { scanId },
        {
          $set: {
            status: ScanBatchStatus.GROUPING_COMPLETED,
            groupingConfirmedAt: new Date(),
          },
        },
      );

      // Publish ScanPersistedEvent so vdf-scan-service cleanup can proceed
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
      channel.ack(originalMsg);
    } catch (err) {
      const error = err as Error;

      if (err instanceof ScanResultValidationError) {
        // Result payload is corrupt — dead-letter without requeue
        this.logger.error({ scanId, err: error.message }, 'Scan result schema invalid — dead-lettering');
        channel.nack(originalMsg, false, false);
        return;
      }

      // Transient failure — nack without requeue; let DLX/retry policy decide
      this.logger.error({ scanId, err: error.message }, 'Grouping failed — nacking message');
      channel.nack(originalMsg, false, false);
    }
  }

  private validateEvent(raw: unknown): ScanCompletedEvent {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('event must be a non-null object');
    }
    const e = raw as Record<string, unknown>;
    const required = ['eventId', 'scanId', 'resultS3Key', 'resultS3Bucket', 'timestamp', 'correlationId'];
    for (const field of required) {
      if (typeof e[field] !== 'string' || !(e[field] as string).trim()) {
        throw new Error(`field "${field}" is required`);
      }
    }
    if (!Array.isArray(e['videoIds']) || (e['videoIds'] as unknown[]).length === 0) {
      throw new Error('field "videoIds" must be a non-empty array');
    }
    return raw as ScanCompletedEvent;
  }

  private async isScanAlreadyGrouped(scanId: string): Promise<boolean> {
    const batch = await this.scanBatchModel
      .findOne({
        scanId,
        status: {
          $in: [
            ScanBatchStatus.GROUPING_COMPLETED,
            ScanBatchStatus.PENDING_CLEANUP,
            ScanBatchStatus.CLEANUP_ALLOWED,
            ScanBatchStatus.CLEANED,
          ],
        },
      })
      .lean()
      .exec();
    return batch !== null;
  }
}
