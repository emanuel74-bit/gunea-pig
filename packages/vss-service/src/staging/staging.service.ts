import { Injectable, Logger } from '@nestjs/common';
import { NewVideoReadyForScanEvent } from '@vdf/shared-types';
import { StagingIdempotencyPolicy } from './staging-idempotency.policy';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { VideoMetadataRepository } from '../infrastructure/video-metadata.repository';
import { S3VideoDownloaderAdapter } from '../infrastructure/s3-video-downloader.adapter';
import { FilesystemStagingWriterAdapter } from '../infrastructure/filesystem-staging-writer.adapter';

export type StagingResult = 'staged' | 'already_staged' | 'metadata_not_found';

@Injectable()
export class StagingService {
  private readonly logger = new Logger(StagingService.name);

  constructor(
    private readonly idempotencyPolicy: StagingIdempotencyPolicy,
    private readonly scanStateRepository: ScanStateRepository,
    private readonly videoMetadataRepository: VideoMetadataRepository,
    private readonly s3Downloader: S3VideoDownloaderAdapter,
    private readonly filesystemWriter: FilesystemStagingWriterAdapter,
  ) {}

  async stage(event: NewVideoReadyForScanEvent): Promise<StagingResult> {
    const existing = await this.scanStateRepository.findByVideoId(event.video_id);
    const currentState = existing?.state ?? null;

    if (!this.idempotencyPolicy.shouldStage(currentState)) {
      this.logger.log(`Skipping already-staged video: ${event.video_id} (state=${currentState})`);
      return 'already_staged';
    }

    const metadata = await this.videoMetadataRepository.findById(event.video_id);
    if (!metadata) {
      this.logger.warn(`Video metadata not found for video_id=${event.video_id}`);
      return 'metadata_not_found';
    }

    const stream = await this.s3Downloader.download(metadata.s3_key);
    await this.filesystemWriter.write(event.video_id, stream);

    await this.scanStateRepository.upsertAwaitingStaging(event.video_id);
    const transitioned = await this.scanStateRepository.transitionToStaged(event.video_id);

    if (!transitioned) {
      this.logger.warn(`CAS transition to staged failed for video_id=${event.video_id} — another worker staged it`);
      return 'already_staged';
    }

    this.logger.log(`Successfully staged video_id=${event.video_id}`);
    return 'staged';
  }
}
