import { Injectable } from '@nestjs/common';
import { RabbitMQPublisher } from '@gunea-pig/shared';
import { IEventPublisher } from '../interfaces/i-event-publisher.port';

/**
 * Wraps RabbitMQPublisher (shared) to implement IEventPublisher.
 * No logic changes — delegates all calls to the underlying RabbitMQPublisher.
 */
@Injectable()
export class RabbitMQPublisherAdapter implements IEventPublisher {
  constructor(private readonly publisher: RabbitMQPublisher) {}

  async publish(message: {
    exchange: string;
    routingKey: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<void> {
    await this.publisher.publish(message);
  }
}
