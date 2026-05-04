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
      prefetchCount: parseInt(process.env.STAGING_CONCURRENCY ?? '5', 10),
      noAck: false,
      isGlobalPrefetchCount: false,
    },
  });

  await app.listen();
  process.stdout.write('[staging-service] Listening for NewVideoReadyEvent messages\n');
}

bootstrap().catch((err: Error) => {
  process.stderr.write(`[staging-service] Fatal: ${err.message}\n`);
  process.exit(1);
});
