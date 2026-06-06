import { Injectable, Logger } from '@nestjs/common';
import { NormalizedScanResult, ScanCompletedEvent } from '@vdf/shared-types';
import { S3ScanResultWriterAdapter } from '../infrastructure/s3-scan-result-writer.adapter';
import { ScanCompletedPublisher } from '../infrastructure/rabbitmq/scan-completed.publisher';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';

@Injectable()
export class ResultPublicationService {
  private readonly logger = new Logger(ResultPublicationService.name);

  constructor(
    private readonly s3Writer: S3ScanResultWriterAdapter,
    private readonly publisher: ScanCompletedPublisher,
    private readonly scanStateRepo: ScanStateRepository,
  ) {}

  async publish(
    videoId: string,
    scanId: string,
    result: NormalizedScanResult,
  ): Promise<void> {
    // S3 write MUST complete before publishing to RabbitMQ.
    // If S3 fails, the event is never published and the consumer can retry safely.
    const s3Key = await this.s3Writer.write(scanId, result);

    const event: ScanCompletedEvent = {
      scan_id: scanId,
      result_location: s3Key,
      scanned_video_ids: [videoId],
      scanner_profile: 'default',
      scanner_version: result.scanner_version,
      timestamp: new Date().toISOString(),
      correlation_id: videoId,
    };

    await this.publisher.publish(event);

    await this.scanStateRepo.transitionToScanComplete(videoId, scanId, s3Key);

    this.logger.log(`Published scan result for video_id=${videoId} scan_id=${scanId}`);
  }
}
