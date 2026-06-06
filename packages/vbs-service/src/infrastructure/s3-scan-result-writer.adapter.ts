import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NormalizedScanResult } from '@vdf/shared-types';

@Injectable()
export class S3ScanResultWriterAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET')!;
    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION')!,
      ...(this.config.get('S3_ENDPOINT')
        ? { endpoint: this.config.get<string>('S3_ENDPOINT')!, forcePathStyle: true }
        : {}),
    });
  }

  async write(scanId: string, result: NormalizedScanResult): Promise<string> {
    const key = `scan-results/${scanId}.json`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(result),
        ContentType: 'application/json',
      }),
    );
    return key;
  }
}
