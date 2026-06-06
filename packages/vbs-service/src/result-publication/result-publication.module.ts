import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScanStateRecord, ScanStateSchema } from '@vdf/shared-types';
import { RabbitMqModule } from '../infrastructure/rabbitmq/rabbitmq.module';
import { S3ScanResultWriterAdapter } from '../infrastructure/s3-scan-result-writer.adapter';
import { ScanCompletedPublisher } from '../infrastructure/rabbitmq/scan-completed.publisher';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { ResultPublicationService } from './result-publication.service';

@Module({
  imports: [
    RabbitMqModule,
    MongooseModule.forFeature([{ name: ScanStateRecord.name, schema: ScanStateSchema }]),
  ],
  providers: [
    S3ScanResultWriterAdapter,
    ScanCompletedPublisher,
    ScanStateRepository,
    ResultPublicationService,
  ],
  exports: [ResultPublicationService],
})
export class ResultPublicationModule {}
