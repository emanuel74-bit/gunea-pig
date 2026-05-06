import * as path from 'path';
import { Global, Module } from '@nestjs/common';
import { S3Adapter, RabbitMQPublisher } from '@gunea-pig/shared';
import { buildConfig } from './config';
import { PIPELINE_CONFIG, SCAN_OUTPUT_DIR } from './injection-tokens';

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
  ],
  exports: [PIPELINE_CONFIG, SCAN_OUTPUT_DIR, S3Adapter, RabbitMQPublisher],
})
export class SharedInfraModule {}
