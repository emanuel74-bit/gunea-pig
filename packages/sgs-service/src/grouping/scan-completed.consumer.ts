import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AMQP_CONNECTION, SCAN_COMPLETED_QUEUE } from '../infrastructure/rabbitmq/rabbitmq.module';
import { ScanResultIngestionService } from './scan-result-ingestion.service';
import { ScanCompletedEvent } from '@vdf/shared-types';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class ScanCompletedConsumer implements OnModuleInit {
  private readonly logger = new Logger(ScanCompletedConsumer.name);

  constructor(
    @Inject(AMQP_CONNECTION)
    private readonly connection: AmqpConnectionManager,
    private readonly ingestionService: ScanResultIngestionService,
  ) {}

  onModuleInit(): void {
    this.connection.createChannel({
      json: true,
      setup: async (channel: import('amqplib').Channel) => {
        await channel.prefetch(1);
        await channel.consume(SCAN_COMPLETED_QUEUE, async (msg: ConsumeMessage | null) => {
          if (!msg) return;
          try {
            const event = JSON.parse(msg.content.toString()) as ScanCompletedEvent;
            await this.ingestionService.ingest(event);
            channel.ack(msg);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Failed to process scan-completed message: ${message}`);
            channel.nack(msg, false, false);
          }
        });
      },
    });
  }
}
