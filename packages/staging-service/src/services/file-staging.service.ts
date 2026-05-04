import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { S3Adapter } from '@gunea-pig/shared';

export interface StagingResult {
  stagedPath: string;
}

/**
 * Service role — materializes a video from S3 onto the local scan filesystem.
 * Responsibilities:
 * - Verifies the S3 object exists before copying.
 * - Streams the file to the scan path (never loads entire video into memory).
 * - Ensures the destination directory exists.
 * - Does NOT run VDF or modify similarity groups.
 */
@Injectable()
export class FileStagingService {
  private readonly logger = new Logger(FileStagingService.name);

  constructor(
    private readonly s3: S3Adapter,
    private readonly scanPath: string,
  ) {}

  /**
   * Verifies the S3 object exists.
   * Throws if the object cannot be found.
   */
  async verifyS3ObjectExists(bucket: string, key: string): Promise<void> {
    const head = await this.s3.headObject({ bucket, key });
    if (!head) {
      throw new S3ObjectNotFoundError(bucket, key);
    }
  }

  /**
   * Downloads the video from S3 and writes it to the local scan path.
   * The filename is derived from the videoId to guarantee uniqueness.
   * Returns the absolute destination path.
   */
  async stageFromS3(videoId: string, bucket: string, key: string): Promise<StagingResult> {
    const ext = path.extname(key) || '.video';
    const fileName = `${videoId}${ext}`;
    const destinationDir = this.scanPath;
    const destinationPath = path.join(destinationDir, fileName);

    this.ensureDirectoryExists(destinationDir);

    this.logger.log(`Staging video videoId=${videoId} from s3://${bucket}/${key} → ${destinationPath}`);

    await this.s3.downloadToFile({ bucket, key }, destinationPath);

    this.logger.log(`Staged successfully videoId=${videoId} path=${destinationPath}`);

    return { stagedPath: destinationPath };
  }

  /**
   * Removes a staged video file from the local filesystem.
   * Used only after the VDF scanner signals cleanup is safe.
   */
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
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export class S3ObjectNotFoundError extends Error {
  constructor(bucket: string, key: string) {
    super(`S3 object not found: s3://${bucket}/${key}`);
    this.name = 'S3ObjectNotFoundError';
  }
}
