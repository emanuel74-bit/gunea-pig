import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AMQP_CONNECTION, NEW_VIDEO_QUEUE } from '../infrastructure/rabbitmq/rabbitmq.module';
import { StagingService } from './staging.service';
import { NewVideoReadyForScanEvent } from '@vdf/shared-types';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class NewVideoConsumer implements OnModuleInit {
  private readonly logger = new Logger(NewVideoConsumer.name);

  constructor(
    @Inject(AMQP_CONNECTION)
    private readonly connection: AmqpConnectionManager,
    private readonly stagingService: StagingService,
  ) {}

  onModuleInit(): void {
    this.connection.createChannel({
      json: true,
      setup: async (channel: import('amqplib').Channel) => {
        await channel.prefetch(1);
        await channel.consume(NEW_VIDEO_QUEUE, async (msg: ConsumeMessage | null) => {
          if (!msg) return;
          try {
            const event = JSON.parse(msg.content.toString()) as NewVideoReadyForScanEvent;
            await this.stagingService.stage(event);
            channel.ack(msg);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to process new-video message: ${message}`);
            channel.nack(msg, false, false);
          }
        });
      },
    });
  }
}
