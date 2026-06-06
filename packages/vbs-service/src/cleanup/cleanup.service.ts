import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);
  private readonly scanPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly scanStateRepo: ScanStateRepository,
  ) {
    this.scanPath = this.config.get<string>('VDF_SCAN_PATH')!;
  }

  async runCleanupCycle(): Promise<void> {
    const candidates = await this.scanStateRepo.findCleanupAllowed(50);
    if (candidates.length === 0) return;

    this.logger.log(`Cleaning up ${candidates.length} videos`);

    for (const record of candidates) {
      try {
        const dir = path.join(this.scanPath, record.video_id);
        await fs.rm(dir, { recursive: true, force: true });
        await this.scanStateRepo.transitionToCleaned(record.video_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Cleanup failed for ${record.video_id}: ${message}`);
      }
    }
  }
}
