import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VdfCliAdapter } from '../infrastructure/vdf/vdf-cli.adapter';
import { VdfOutputNormalizerAdapter } from '../infrastructure/vdf/vdf-output-normalizer.adapter';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { ResultPublicationService } from '../result-publication/result-publication.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ScanExecutionService {
  private readonly logger = new Logger(ScanExecutionService.name);
  private readonly scanPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly vdfCli: VdfCliAdapter,
    private readonly normalizer: VdfOutputNormalizerAdapter,
    private readonly scanStateRepo: ScanStateRepository,
    private readonly resultPublicationService: ResultPublicationService,
  ) {
    this.scanPath = this.config.get<string>('VDF_SCAN_PATH')!;
  }

  async executeBatch(videoIds: string[], batchClaimId: string): Promise<void> {
    for (const videoId of videoIds) {
      await this.executeOne(videoId, batchClaimId);
    }
  }

  private async executeOne(videoId: string, batchClaimId: string): Promise<void> {
    const videoScanPath = `${this.scanPath}/${videoId}`;

    const transitioned = await this.scanStateRepo.transitionToScanning(videoId, batchClaimId);
    if (!transitioned) {
      this.logger.warn(`Could not transition ${videoId} to scanning — skipping`);
      return;
    }

    try {
      const rawOutput = await this.vdfCli.scan(videoScanPath);
      const scanId = uuidv4();
      const normalized = this.normalizer.normalize(rawOutput, scanId);

      await this.resultPublicationService.publish(videoId, scanId, normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`VDF scan failed for ${videoId}: ${message}`);
      await this.scanStateRepo.transitionToFailed(videoId, message);
    }
  }
}
