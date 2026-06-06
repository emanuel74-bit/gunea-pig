import { Module } from '@nestjs/common';
import amqp from 'amqp-connection-manager';
import { ConfigService } from '@nestjs/config';

export const AMQP_CONNECTION = 'AMQP_CONNECTION';
export const INGEST_EXCHANGE = 'vdf.pipeline.ingest';
export const NEW_VIDEO_QUEUE = 'vdf.pipeline.ingest.new-video';
export const NEW_VIDEO_ROUTING_KEY = 'new-video-ready-for-scan';

@Module({
  providers: [
    {
      provide: AMQP_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const connection = amqp.connect([config.get<string>('RABBITMQ_URL')!]);
        connection.createChannel({
          json: true,
          setup: async (channel: import('amqplib').Channel) => {
            await channel.assertExchange(INGEST_EXCHANGE, 'topic', { durable: true });
            await channel.assertQueue(NEW_VIDEO_QUEUE, {
              durable: true,
              arguments: {
                'x-dead-letter-exchange': `${INGEST_EXCHANGE}.dlx`,
              },
            });
            await channel.bindQueue(NEW_VIDEO_QUEUE, INGEST_EXCHANGE, NEW_VIDEO_ROUTING_KEY);
          },
        });
        return connection;
      },
    },
  ],
  exports: [AMQP_CONNECTION],
})
export class RabbitMqModule {}
