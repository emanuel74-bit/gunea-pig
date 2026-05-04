import * as amqplib from 'amqplib';
import { QUEUE_EXCHANGES, QUEUE_NAMES, ROUTING_KEYS } from '../types/queue.types';

export interface RabbitMQPublishOptions {
  exchange: string;
  routingKey: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  persistent?: boolean;
}

/**
 * Thin amqplib wrapper for publishing events to RabbitMQ topic exchanges.
 * Uses amqplib v0.10 ChannelModel API (connect() returns ChannelModel).
 */
export class RabbitMQPublisher {
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.ConfirmChannel | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelayMs = 5000;

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    try {
      this.connection = await amqplib.connect(this.url);
      this.channel = await this.connection.createConfirmChannel();
      await this.assertTopology();

      this.connection.on('error', (err: Error) => {
        process.stderr.write(`[RabbitMQPublisher] connection error: ${err.message}\n`);
        this.scheduleReconnect();
      });
      this.connection.on('close', () => {
        process.stderr.write('[RabbitMQPublisher] connection closed\n');
        this.scheduleReconnect();
      });
    } catch (err) {
      const error = err as Error;
      process.stderr.write(`[RabbitMQPublisher] connect failed: ${error.message}\n`);
      this.scheduleReconnect();
    }
  }

  private async assertTopology(): Promise<void> {
    if (!this.channel) return;
    const ch = this.channel;

    // Main topic exchanges
    await ch.assertExchange(QUEUE_EXCHANGES.VIDEO_EVENTS, 'topic', { durable: true });
    await ch.assertExchange(QUEUE_EXCHANGES.SCAN_EVENTS, 'topic', { durable: true });

    // Dead-letter exchanges
    await ch.assertExchange(QUEUE_EXCHANGES.VIDEO_EVENTS_DLX, 'topic', { durable: true });
    await ch.assertExchange(QUEUE_EXCHANGES.SCAN_EVENTS_DLX, 'topic', { durable: true });

    // Dead-letter queues
    await ch.assertQueue(QUEUE_NAMES.DEAD_STAGING, { durable: true });
    await ch.assertQueue(QUEUE_NAMES.DEAD_GROUPING, { durable: true });
    await ch.assertQueue(QUEUE_NAMES.DEAD_SCANNER_PERSISTED, { durable: true });

    await ch.bindQueue(QUEUE_NAMES.DEAD_STAGING, QUEUE_EXCHANGES.VIDEO_EVENTS_DLX, ROUTING_KEYS.DEAD_VIDEO_READY);
    await ch.bindQueue(QUEUE_NAMES.DEAD_GROUPING, QUEUE_EXCHANGES.SCAN_EVENTS_DLX, ROUTING_KEYS.DEAD_SCAN_COMPLETED);
    await ch.bindQueue(QUEUE_NAMES.DEAD_SCANNER_PERSISTED, QUEUE_EXCHANGES.SCAN_EVENTS_DLX, ROUTING_KEYS.DEAD_SCAN_PERSISTED);

    // Consumer queues with DLX configured
    await ch.assertQueue(QUEUE_NAMES.STAGING_NEW_VIDEO, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': QUEUE_EXCHANGES.VIDEO_EVENTS_DLX,
        'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_VIDEO_READY,
      },
    });
    await ch.assertQueue(QUEUE_NAMES.GROUPING_SCAN_COMPLETED, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': QUEUE_EXCHANGES.SCAN_EVENTS_DLX,
        'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_SCAN_COMPLETED,
      },
    });
    await ch.assertQueue(QUEUE_NAMES.SCANNER_SCAN_PERSISTED, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': QUEUE_EXCHANGES.SCAN_EVENTS_DLX,
        'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_SCAN_PERSISTED,
      },
    });

    // Bindings
    await ch.bindQueue(QUEUE_NAMES.STAGING_NEW_VIDEO, QUEUE_EXCHANGES.VIDEO_EVENTS, ROUTING_KEYS.VIDEO_READY_FOR_SCAN);
    await ch.bindQueue(QUEUE_NAMES.GROUPING_SCAN_COMPLETED, QUEUE_EXCHANGES.SCAN_EVENTS, ROUTING_KEYS.SCAN_COMPLETED);
    await ch.bindQueue(QUEUE_NAMES.SCANNER_SCAN_PERSISTED, QUEUE_EXCHANGES.SCAN_EVENTS, ROUTING_KEYS.SCAN_PERSISTED);
  }

  async publish(opts: RabbitMQPublishOptions): Promise<void> {
    if (!this.channel) {
      throw new Error('[RabbitMQPublisher] channel not ready');
    }
    const buffer = Buffer.from(JSON.stringify(opts.payload));

    await new Promise<void>((resolve, reject) => {
      this.channel!.publish(
        opts.exchange,
        opts.routingKey,
        buffer,
        {
          persistent: opts.persistent !== false,
          contentType: 'application/json',
          correlationId: opts.correlationId,
          timestamp: Math.floor(Date.now() / 1000),
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.channel) await this.channel.close().catch(() => undefined);
    if (this.connection) await this.connection.close().catch(() => undefined);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, this.reconnectDelayMs);
  }
}
