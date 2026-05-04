import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import * as fs from 'fs';

export interface S3ClientConfig {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface S3ObjectRef {
  bucket: string;
  key: string;
}

/**
 * Thin adapter over AWS SDK v3 S3Client.
 * All operations are stateless; the client is injected or constructed once.
 */
export class S3Adapter {
  private readonly client: S3Client;

  constructor(config: S3ClientConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  /**
   * Checks whether an object exists in S3.
   * Returns the HeadObject response or null if the object does not exist.
   */
  async headObject(ref: S3ObjectRef): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.client.send(new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }));
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Downloads an S3 object and streams it to a local file path.
   * Uses streaming to avoid loading the full video into memory.
   */
  async downloadToFile(ref: S3ObjectRef, destinationPath: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );

    if (!response.Body) {
      throw new Error(`[S3Adapter] empty body for ${ref.bucket}/${ref.key}`);
    }

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(destinationPath);
      (response.Body as Readable).pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      (response.Body as Readable).on('error', reject);
    });
  }

  /**
   * Uploads a JSON-serializable payload to S3.
   */
  async putJson<T>(ref: S3ObjectRef, payload: T): Promise<void> {
    const body = JSON.stringify(payload);
    await this.client.send(
      new PutObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        Body: body,
        ContentType: 'application/json',
      }),
    );
  }

  /**
   * Downloads and parses a JSON object from S3.
   */
  async getJson<T>(ref: S3ObjectRef): Promise<T> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );

    if (!response.Body) {
      throw new Error(`[S3Adapter] empty body for ${ref.bucket}/${ref.key}`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T;
  }

  /**
   * Uploads a local file to S3 using multipart upload for large files.
   */
  async uploadFile(ref: S3ObjectRef, filePath: string, contentType?: string): Promise<void> {
    const fileStream = fs.createReadStream(filePath);
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: ref.bucket,
        Key: ref.key,
        Body: fileStream,
        ContentType: contentType ?? 'application/octet-stream',
      },
    });
    await upload.done();
  }
}
