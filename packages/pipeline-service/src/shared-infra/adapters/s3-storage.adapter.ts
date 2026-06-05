import { Injectable } from '@nestjs/common';
import { S3Adapter } from '@gunea-pig/shared';
import { IStoragePort } from '../interfaces/i-storage.port';

/**
 * Wraps S3Adapter (shared) to implement IStoragePort.
 * No logic changes — delegates all calls to the underlying S3Adapter.
 */
@Injectable()
export class S3StorageAdapter implements IStoragePort {
  constructor(private readonly s3: S3Adapter) {}

  async putJson(target: { bucket: string; key: string }, payload: unknown): Promise<void> {
    await this.s3.putJson(target, payload);
  }

  async getJson<T>(target: { bucket: string; key: string }): Promise<T> {
    return this.s3.getJson<T>(target);
  }

  async headObject(target: { bucket: string; key: string }): Promise<unknown> {
    return this.s3.headObject(target);
  }

  async downloadToFile(target: { bucket: string; key: string }, destinationPath: string): Promise<void> {
    await this.s3.downloadToFile(target, destinationPath);
  }
}
