import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

@Injectable()
export class FilesystemStagingWriterAdapter {
  private readonly scanPath: string;

  constructor(private readonly config: ConfigService) {
    this.scanPath = this.config.get<string>('VDF_SCAN_PATH')!;
  }

  async write(videoId: string, stream: Readable): Promise<string> {
    const destDir = path.join(this.scanPath, videoId);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, 'video');
    await pipeline(stream, createWriteStream(destPath));
    return destPath;
  }

  async remove(videoId: string): Promise<void> {
    const destDir = path.join(this.scanPath, videoId);
    await fs.rm(destDir, { recursive: true, force: true });
  }
}
