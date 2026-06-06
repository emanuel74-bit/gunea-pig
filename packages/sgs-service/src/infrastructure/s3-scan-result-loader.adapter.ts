import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NormalizedScanResult } from '@vdf/shared-types';
import { Readable } from 'stream';

@Injectable()
export class S3ScanResultLoaderAdapter {
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

  async load(s3Key: string): Promise<NormalizedScanResult> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as NormalizedScanResult;
  }
}
