import { ScanState } from '@vdf/shared-types';
import { StagingIdempotencyPolicy } from './staging-idempotency.policy';

describe('StagingIdempotencyPolicy', () => {
  let policy: StagingIdempotencyPolicy;

  beforeEach(() => {
    policy = new StagingIdempotencyPolicy();
  });

  it('returns true (should_stage) for awaiting_staging state', () => {
    expect(policy.shouldStage(ScanState.AWAITING_STAGING)).toBe(true);
  });

  it('returns true when no existing state (new video)', () => {
    expect(policy.shouldStage(null)).toBe(true);
  });

  it('returns false (skip) for staged state', () => {
    expect(policy.shouldStage(ScanState.STAGED)).toBe(false);
  });

  it('returns false (skip) for claimed state', () => {
    expect(policy.shouldStage(ScanState.CLAIMED)).toBe(false);
  });

  it('returns false (skip) for scanning state', () => {
    expect(policy.shouldStage(ScanState.SCANNING)).toBe(false);
  });

  it('returns false (skip) for scan_complete state', () => {
    expect(policy.shouldStage(ScanState.SCAN_COMPLETE)).toBe(false);
  });

  it('returns false (skip) for grouping_complete state', () => {
    expect(policy.shouldStage(ScanState.GROUPING_COMPLETE)).toBe(false);
  });

  it('returns false (skip) for cleaned state', () => {
    expect(policy.shouldStage(ScanState.CLEANED)).toBe(false);
  });
});
