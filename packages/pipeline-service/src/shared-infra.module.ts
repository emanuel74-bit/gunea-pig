import * as path from 'path';
import { Global, Module } from '@nestjs/common';
import { S3Adapter, RabbitMQPublisher } from '@gunea-pig/shared';
import { buildConfig } from './config';
import { PIPELINE_CONFIG, SCAN_OUTPUT_DIR, I_STORAGE, I_EVENT_PUBLISHER } from './injection-tokens';
import { S3StorageAdapter } from './shared-infra/adapters/s3-storage.adapter';
import { RabbitMQPublisherAdapter } from './shared-infra/adapters/rabbitmq-publisher.adapter';

const config = buildConfig();

@Global()
@Module({
  providers: [
    { provide: PIPELINE_CONFIG, useValue: config },
    {
      provide: SCAN_OUTPUT_DIR,
      useValue: path.join(config.staging.scanPath, '.vdf-output'),
    },
    {
      provide: S3Adapter,
      useFactory: () =>
        new S3Adapter({
          endpoint: config.s3.endpoint,
          region: config.s3.region,
          accessKeyId: config.s3.accessKeyId,
          secretAccessKey: config.s3.secretAccessKey,
        }),
    },
    {
      provide: RabbitMQPublisher,
      useFactory: async () => {
        const publisher = new RabbitMQPublisher(config.rabbitmqUrl);
        await publisher.connect();
        return publisher;
      },
    },
    {
      provide: I_STORAGE,
      useFactory: (s3: S3Adapter) => new S3StorageAdapter(s3),
      inject: [S3Adapter],
    },
    {
      provide: I_EVENT_PUBLISHER,
      useFactory: (publisher: RabbitMQPublisher) => new RabbitMQPublisherAdapter(publisher),
      inject: [RabbitMQPublisher],
    },
  ],
  exports: [PIPELINE_CONFIG, SCAN_OUTPUT_DIR, S3Adapter, RabbitMQPublisher, I_STORAGE, I_EVENT_PUBLISHER],
})
export class SharedInfraModule {}
