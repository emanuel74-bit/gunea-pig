import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { QUEUE_EXCHANGES, QUEUE_NAMES, ROUTING_KEYS } from '@gunea-pig/shared';
import { buildConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = buildConfig();

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.rabbitmqUrl],
      queue: QUEUE_NAMES.STAGING_NEW_VIDEO,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': QUEUE_EXCHANGES.VIDEO_EVENTS_DLX,
          'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_VIDEO_READY,
        },
      },
      exchangeType: 'topic',
      exchange: QUEUE_EXCHANGES.VIDEO_EVENTS,
      routingKey: ROUTING_KEYS.VIDEO_READY_FOR_SCAN,
      prefetchCount: config.staging.concurrency,
      noAck: false,
      isGlobalPrefetchCount: false,
    },
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.rabbitmqUrl],
      queue: QUEUE_NAMES.GROUPING_SCAN_COMPLETED,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': QUEUE_EXCHANGES.SCAN_EVENTS_DLX,
          'x-dead-letter-routing-key': ROUTING_KEYS.DEAD_SCAN_COMPLETED,
        },
      },
      exchangeType: 'topic',
      exchange: QUEUE_EXCHANGES.SCAN_EVENTS,
      routingKey: ROUTING_KEYS.SCAN_COMPLETED,
      prefetchCount: 5,
      noAck: false,
      isGlobalPrefetchCount: false,
    },
  });

  process.on('SIGTERM', async () => {
    await app.close();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });

  await app.startAllMicroservices();
  process.stdout.write('[pipeline-service] Listening for events\n');
}

bootstrap().catch((err: Error) => {
  process.stderr.write(`[pipeline-service] Fatal startup error: ${err.message}\n`);
  process.exit(1);
});
