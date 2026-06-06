import { Module } from '@nestjs/common';
import amqp from 'amqp-connection-manager';
import { ConfigService } from '@nestjs/config';

export const AMQP_CONNECTION = 'AMQP_CONNECTION';
export const SCAN_EXCHANGE = 'vdf.pipeline.scan';
export const SCAN_COMPLETED_ROUTING_KEY = 'scan-completed';

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
            await channel.assertExchange(SCAN_EXCHANGE, 'topic', { durable: true });
          },
        });
        return connection;
      },
    },
  ],
  exports: [AMQP_CONNECTION],
})
export class RabbitMqModule {}
