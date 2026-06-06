import { ClaimOwnershipPolicy } from './claim-ownership.policy';

describe('ClaimOwnershipPolicy', () => {
  let policy: ClaimOwnershipPolicy;
  const now = new Date('2026-01-01T12:00:00Z');

  beforeEach(() => {
    policy = new ClaimOwnershipPolicy();
  });

  it('returns true when no claim exists', () => {
    expect(policy.isClaimable(null, now)).toBe(true);
  });

  it('returns true when claim exists but is expired', () => {
    const expiredClaim = {
      claim_id: 'c1',
      video_ids: ['v1'],
      claimed_at: new Date('2026-01-01T11:00:00Z'),
      expires_at: new Date('2026-01-01T11:30:00Z'),
    };
    expect(policy.isClaimable(expiredClaim, now)).toBe(true);
  });

  it('returns false when active non-expired claim exists', () => {
    const activeClaim = {
      claim_id: 'c2',
      video_ids: ['v1'],
      claimed_at: new Date('2026-01-01T11:50:00Z'),
      expires_at: new Date('2026-01-01T12:30:00Z'),
    };
    expect(policy.isClaimable(activeClaim, now)).toBe(false);
  });
});
