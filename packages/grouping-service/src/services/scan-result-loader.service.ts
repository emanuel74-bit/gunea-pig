import { Inject, Injectable, Logger } from '@nestjs/common';
import { NormalizedScanResult, S3Adapter } from '@gunea-pig/shared';
import { GroupingConfig, GROUPING_CONFIG } from '../config';
import { validateScanResult } from '../validators/scan-result.validator';

/**
 * Service role — loads and validates the normalized scan result from S3.
 *
 * Responsibilities:
 * - Fetches the JSON payload from the durable S3 location.
 * - Validates the schema and version.
 * - Returns a strongly typed NormalizedScanResult.
 *
 * Must not copy video files from S3.
 * Must not run VDF.
 * Must not depend on VDF internal state.
 */
@Injectable()
export class ScanResultLoaderService {
  private readonly logger = new Logger(ScanResultLoaderService.name);

  constructor(
    private readonly s3: S3Adapter,
    @Inject(GROUPING_CONFIG)
    private readonly config: GroupingConfig,
  ) {}

  /**
   * Loads and validates a scan result from its durable S3 location.
   * Retries are handled by the caller (RabbitMQ nack + requeue).
   */
  async load(resultS3Bucket: string, resultS3Key: string): Promise<NormalizedScanResult> {
    this.logger.log({ resultS3Bucket, resultS3Key }, 'Loading scan result from S3');

    const raw = await this.s3.getJson<unknown>({ bucket: resultS3Bucket, key: resultS3Key });

    const result = validateScanResult(raw);

    this.logger.log(
      { scanId: result.scanId, matchCount: result.matches.length },
      'Scan result loaded and validated',
    );

    return result;
  }
}
