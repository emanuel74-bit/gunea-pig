import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BatchClaimService } from './batch-claim.service';

@Injectable()
export class BatchClaimScheduler {
  private readonly logger = new Logger(BatchClaimScheduler.name);
  private readonly interval: string;

  constructor(
    private readonly config: ConfigService,
    private readonly batchClaimService: BatchClaimService,
  ) {
    this.interval = this.config.get<string>('BATCH_CLAIM_INTERVAL') ?? '*/30 * * * * *';
  }

  @Cron('*/30 * * * * *')
  async handleCron(): Promise<void> {
    try {
      await this.batchClaimService.runClaimCycle();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Batch claim cycle failed: ${message}`);
    }
  }
}
