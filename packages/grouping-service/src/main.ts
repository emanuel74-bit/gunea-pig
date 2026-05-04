import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { QUEUE_EXCHANGES, QUEUE_NAMES, ROUTING_KEYS } from '@gunea-pig/shared';
import { buildConfig } from './config';

async function bootstrap(): Promise<void> {
  const config = buildConfig();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
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

  await app.listen();
  process.stdout.write('[grouping-service] Listening for ScanCompletedEvent messages\n');
}

bootstrap().catch((err: Error) => {
  process.stderr.write(`[grouping-service] Fatal: ${err.message}\n`);
  process.exit(1);
});
