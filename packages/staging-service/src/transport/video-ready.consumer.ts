import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import {
  validateStagingMessage,
  StagingMessageValidationError,
} from '../validators/staging-message.validator';
import {
  StageVideoHandler,
  VideoAlreadyStagedError,
  StagingPermanentFailureError,
} from '../application/stage-video.handler';

@Controller()
export class VideoReadyConsumer {
  private readonly logger = new Logger(VideoReadyConsumer.name);

  constructor(private readonly handler: StageVideoHandler) {}

  @EventPattern('video.ready-for-scan')
  async handle(@Payload() rawPayload: unknown, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef() as {
      ack: (msg: unknown) => void;
      nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    const msg = context.getMessage();

    let event;
    try {
      event = validateStagingMessage(rawPayload);
    } catch (err) {
      const error = err as StagingMessageValidationError;
      this.logger.error(`Schema validation failed: ${error.message}`);
      channel.nack(msg, false, false);
      return;
    }

    const { videoId, correlationId } = event;
    this.logger.log({ videoId, correlationId }, 'Received NewVideoReadyEvent');

    try {
      await this.handler.handle(event);
      channel.ack(msg);
    } catch (err) {
      if (err instanceof VideoAlreadyStagedError) {
        this.logger.log({ videoId }, 'Already staged — idempotent ack');
        channel.ack(msg);
        return;
      }

      const error = err as Error;
      this.logger.error({ videoId, correlationId, err: error.message }, 'Staging failed');

      if (err instanceof StagingPermanentFailureError) {
        channel.nack(msg, false, false);
        return;
      }

      channel.nack(msg, false, false);
    }
  }
}
