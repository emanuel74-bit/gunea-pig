import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { NewVideoReadyEvent, ScanState } from '@gunea-pig/shared';
import {
  validateStagingMessage,
  StagingMessageValidationError,
} from '../validators/staging-message.validator';
import { VideoMongoService } from '../services/video-mongo.service';
import { FileStagingService, S3ObjectNotFoundError } from '../services/file-staging.service';

/**
 * Handler role — transport entry point for NewVideoReadyEvent messages.
 *
 * Responsibilities:
 * - Validates the message schema at the boundary.
 * - Checks idempotency (skip if already staged).
 * - Delegates staging work to FileStagingService.
 * - Updates MongoDB state via VideoMongoService.
 * - ACKs or NACKs the RabbitMQ message.
 *
 * Must not run VDF. Must not modify similarity groups.
 */
@Controller()
export class StagingHandler {
  private readonly logger = new Logger(StagingHandler.name);

  constructor(
    private readonly videoMongo: VideoMongoService,
    private readonly fileStaging: FileStagingService,
  ) {}

  @EventPattern('video.ready-for-scan')
  async handleNewVideoReady(
    @Payload() rawPayload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as {
      ack: (msg: unknown) => void;
      nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    const originalMsg = context.getMessage();

    let event: NewVideoReadyEvent;
    try {
      event = validateStagingMessage(rawPayload);
    } catch (err) {
      const error = err as StagingMessageValidationError;
      this.logger.error(`Message validation failed: ${error.message}`);
      // Message is malformed — dead-letter immediately, no requeue
      channel.nack(originalMsg, false, false);
      return;
    }

    const { videoId, s3ObjectKey, s3Bucket, correlationId } = event;

    this.logger.log({ videoId, correlationId }, 'Received NewVideoReadyEvent');

    try {
      // Idempotency guard — skip if video is already staged or beyond
      const alreadyStaged = await this.videoMongo.isAlreadyStaged(videoId);
      if (alreadyStaged) {
        this.logger.log({ videoId }, 'Video already staged — skipping (idempotent)');
        channel.ack(originalMsg);
        return;
      }

      // Upsert the video document (creates if absent)
      await this.videoMongo.upsertPendingStaging(videoId, s3ObjectKey, s3Bucket);

      // Verify S3 object exists before attempting download
      await this.fileStaging.verifyS3ObjectExists(s3Bucket, s3ObjectKey);

      // Stream video from S3 → local scan path
      const { stagedPath } = await this.fileStaging.stageFromS3(videoId, s3Bucket, s3ObjectKey);

      // Persist staged state in MongoDB
      await this.videoMongo.markStaged(videoId, stagedPath);

      this.logger.log({ videoId, stagedPath, correlationId }, 'Video staged successfully');
      channel.ack(originalMsg);
    } catch (err) {
      const error = err as Error;
      this.logger.error({ videoId, correlationId, err: error.message }, 'Staging failed');

      if (err instanceof S3ObjectNotFoundError) {
        // S3 object missing — mark failed, do not requeue (permanent failure)
        await this.videoMongo.markStagingFailed(videoId).catch(() => undefined);
        channel.nack(originalMsg, false, false);
        return;
      }

      // Transient failure — mark failed but let DLX/retry policy handle it
      await this.videoMongo.markStagingFailed(videoId).catch(() => undefined);
      channel.nack(originalMsg, false, false);
    }
  }
}
