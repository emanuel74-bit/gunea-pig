import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScanStateRepository } from '../infrastructure/scan-state.repository';
import { BatchClaimRepository } from '../infrastructure/batch-claim.repository';
import { ClaimOwnershipPolicy } from './claim-ownership.policy';
import { ScanExecutionService } from '../scan-execution/scan-execution.service';

@Injectable()
export class BatchClaimService {
  private readonly logger = new Logger(BatchClaimService.name);
  private readonly batchSize: number;
  private readonly ttlMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly scanStateRepo: ScanStateRepository,
    private readonly batchClaimRepo: BatchClaimRepository,
    private readonly claimPolicy: ClaimOwnershipPolicy,
    private readonly scanExecutionService: ScanExecutionService,
  ) {
    this.batchSize = this.config.get<number>('BATCH_SIZE') ?? 10;
    this.ttlMs = this.config.get<number>('BATCH_CLAIM_TTL_MS') ?? 300000;
  }

  async runClaimCycle(): Promise<void> {
    const activeClaims = await this.batchClaimRepo.findActive();
    const isClaimable = this.claimPolicy.isClaimable(
      activeClaims.length > 0 ? activeClaims[0] : null,
      new Date(),
    );

    if (!isClaimable) {
      this.logger.debug('Active claim exists — skipping claim cycle');
      return;
    }

    const staged = await this.scanStateRepo.findStagedBatch(this.batchSize);
    if (staged.length === 0) {
      this.logger.debug('No staged videos to claim');
      return;
    }

    const videoIds = staged.map((s) => s.video_id);
    const claim = await this.batchClaimRepo.create(videoIds, this.ttlMs);

    this.logger.log(`Claimed batch ${claim.claim_id} with ${videoIds.length} videos`);

    for (const videoId of videoIds) {
      await this.scanStateRepo.transitionToClaimed(videoId, claim.claim_id);
    }

    await this.scanExecutionService.executeBatch(videoIds, claim.claim_id);
    await this.batchClaimRepo.deleteById(claim.claim_id);
  }
}
