import { Injectable } from '@nestjs/common';
import { ScanState } from '@vdf/shared-types';

const STAGEABLE_STATES = new Set<ScanState>([ScanState.AWAITING_STAGING]);

@Injectable()
export class StagingIdempotencyPolicy {
  shouldStage(currentState: ScanState | null): boolean {
    if (currentState === null) return true;
    return STAGEABLE_STATES.has(currentState);
  }
}
