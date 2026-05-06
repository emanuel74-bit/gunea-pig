import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { ScanCompletedEvent } from '@gunea-pig/shared';
import { ScanResultValidationError } from '../infrastructure/scan-result.validator';
import {
  ProcessScanHandler,
  ScanAlreadyGroupedError,
} from '../application/process-scan.handler';

@Controller()
export class ScanCompletedConsumer {
  private readonly logger = new Logger(ScanCompletedConsumer.name);

  constructor(private readonly handler: ProcessScanHandler) {}

  @EventPattern('scan.completed')
  async handle(@Payload() rawPayload: unknown, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef() as {
      ack: (msg: unknown) => void;
      nack: (msg: unknown, allUpTo: boolean, requeue: boolean) => void;
    };
    const msg = context.getMessage();

    let event: ScanCompletedEvent;
    try {
      event = this.validateEvent(rawPayload);
    } catch (err) {
      const error = err as Error;
      this.logger.error(`Event validation failed: ${error.message}`);
      channel.nack(msg, false, false);
      return;
    }

    const { scanId, correlationId } = event;
    this.logger.log({ scanId, correlationId }, 'Received ScanCompletedEvent');

    try {
      await this.handler.handle(event);
      channel.ack(msg);
    } catch (err) {
      if (err instanceof ScanAlreadyGroupedError) {
        this.logger.log({ scanId }, 'Already grouped — idempotent ack');
        channel.ack(msg);
        return;
      }

      const error = err as Error;
      this.logger.error({ scanId, correlationId, err: error.message }, 'Grouping failed');

      if (err instanceof ScanResultValidationError) {
        channel.nack(msg, false, false);
        return;
      }

      channel.nack(msg, false, false);
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
}
