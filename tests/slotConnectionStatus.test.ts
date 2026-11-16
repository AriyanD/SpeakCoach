import { describe, expect, it } from 'vitest';
import { isOnlineProviderVerified } from '../src/services/slotConnectionStatus';

describe('slot online verification status', () => {
  it('keeps the slot online when API 1 fails but API 2 passes', () => {
    expect(isOnlineProviderVerified(
      { ok: false, tier: 1 },
      { verified: true, testResult: { ok: true, latencyMs: 120, message: 'PASS', testedAt: 1 } }
    )).toBe(true);
  });

  it('keeps the slot online when API 1 passes even if API 2 fails', () => {
    expect(isOnlineProviderVerified(
      { ok: true, tier: 1 },
      { verified: false, testResult: { ok: false, latencyMs: 0, message: 'FAIL', testedAt: 1 } }
    )).toBe(true);
  });

  it('does not treat an unverified or offline API 2 as online', () => {
    expect(isOnlineProviderVerified(
      { ok: false, tier: 1 },
      { verified: false, testResult: { ok: true, latencyMs: 10, message: 'PASS', testedAt: 1 } }
    )).toBe(false);
    expect(isOnlineProviderVerified(undefined, {
      verified: true, testResult: { ok: false, latencyMs: 0, message: 'FAIL', testedAt: 1 }
    })).toBe(false);
  });

  it('does not treat a successful Tier 3 primary as online AI', () => {
    expect(isOnlineProviderVerified({ ok: true, tier: 3 })).toBe(false);
  });
});
