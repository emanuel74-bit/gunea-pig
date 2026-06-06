import { Inject, Injectable } from '@nestjs/common';
import { ScanCompletedEvent } from '@vdf/shared-types';
import { AMQP_CONNECTION, SCAN_EXCHANGE, SCAN_COMPLETED_ROUTING_KEY } from './rabbitmq.module';
import type { AmqpConnectionManager } from 'amqp-connection-manager';

@Injectable()
export class ScanCompletedPublisher {
  constructor(
    @Inject(AMQP_CONNECTION)
    private readonly connection: AmqpConnectionManager,
  ) {}

  async publish(event: ScanCompletedEvent): Promise<void> {
    const channel = this.connection.createChannel({ json: true });
    await channel.publish(SCAN_EXCHANGE, SCAN_COMPLETED_ROUTING_KEY, event);
    await channel.close();
  }
}
