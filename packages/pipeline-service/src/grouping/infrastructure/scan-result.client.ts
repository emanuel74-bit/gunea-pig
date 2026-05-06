import { Injectable, Logger } from '@nestjs/common';
import { NormalizedScanResult, S3Adapter } from '@gunea-pig/shared';
import { validateScanResult } from './scan-result.validator';

@Injectable()
export class ScanResultClient {
  private readonly logger = new Logger(ScanResultClient.name);

  constructor(private readonly s3: S3Adapter) {}

  async load(resultS3Bucket: string, resultS3Key: string): Promise<NormalizedScanResult> {
    this.logger.log({ resultS3Bucket, resultS3Key }, 'Loading scan result from S3');
    const raw = await this.s3.getJson<unknown>({ bucket: resultS3Bucket, key: resultS3Key });
    const result = validateScanResult(raw);
    this.logger.log({ scanId: result.scanId, matchCount: result.matches.length }, 'Scan result loaded');
    return result;
  }
}
