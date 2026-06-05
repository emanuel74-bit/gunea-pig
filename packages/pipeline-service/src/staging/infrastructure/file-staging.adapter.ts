import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { S3Adapter } from '@gunea-pig/shared';
import { IFileStagingPort } from '../interfaces/i-file-staging.port';

export interface StagingResult {
  stagedPath: string;
}

export class S3ObjectNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`S3 object not found: s3://${bucket}/${key}`);
    this.name = 'S3ObjectNotFoundError';
  }
}

@Injectable()
export class FileStagingAdapter implements IFileStagingPort {
  private readonly logger = new Logger(FileStagingAdapter.name);

  constructor(
    private readonly s3: S3Adapter,
    private readonly scanPath: string,
  ) {}

  async verifyS3ObjectExists(bucket: string, key: string): Promise<void> {
    const head = await this.s3.headObject({ bucket, key });
    if (!head) throw new S3ObjectNotFoundError(bucket, key);
  }

  async stageFromS3(videoId: string, bucket: string, key: string): Promise<StagingResult> {
    const ext = path.extname(key) || '.video';
    const destinationPath = path.join(this.scanPath, `${videoId}${ext}`);

    this.ensureDirectoryExists(this.scanPath);
    this.logger.log(`Staging videoId=${videoId} from s3://${bucket}/${key} → ${destinationPath}`);
    await this.s3.downloadToFile({ bucket, key }, destinationPath);
    this.logger.log(`Staged successfully videoId=${videoId} path=${destinationPath}`);

    return { stagedPath: destinationPath };
  }

  async removeStagedFile(stagedPath: string): Promise<void> {
    if (!stagedPath) return;
    try {
      await fs.promises.unlink(stagedPath);
      this.logger.log(`Removed staged file: ${stagedPath}`);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') throw err;
      this.logger.warn(`Staged file already absent: ${stagedPath}`);
    }
  }

  private ensureDirectoryExists(dir: string): void {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
