import { Injectable } from '@nestjs/common';
import type { BatchClaim } from '../infrastructure/batch-claim.repository';

@Injectable()
export class ClaimOwnershipPolicy {
  isClaimable(existingClaim: BatchClaim | null, now: Date): boolean {
    if (!existingClaim) return true;
    return existingClaim.expires_at <= now;
  }
}
