import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

export interface StoragePort {
  download(key: string): Promise<Readable>;
}

@Injectable()
export class S3VideoDownloaderAdapter implements StoragePort {
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

  async download(key: string): Promise<Readable> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    return response.Body as Readable;
  }
}
