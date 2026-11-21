import { beforeEach, describe, expect, it } from 'vitest';
import { CONNECTION_VERIFICATION_TTL_MS } from '../src/services/tierManager';
import {
  clearProviderAccountHealth,
  createProviderVerificationFingerprint,
  markProviderAccountFailure
} from '../src/services/providerHealth';
import { isWhisperAccountReady } from '../src/services/whisperSttService';

describe('Whisper STT provider verification', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearProviderAccountHealth('pronunciation_scoring');
  });

  it('requires a matching API-key/config fingerprint and a fresh 30-day test', async () => {
    const config = {
      slotId: 'pronunciation_scoring' as const,
      providerId: 'whisper_alignment',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3'
    };
    const apiKey = 'whisper-key-one';
    const fingerprint = await createProviderVerificationFingerprint(config, apiKey);
    if (!fingerprint) return;
    const verification = {
      ok: true, providerId: 'whisper_alignment', tier: 2,
      testedAt: 10_000, verificationFingerprint: fingerprint
    };
    const params = { slotId: 'pronunciation_scoring' as const, account: 'primary' as const, config, apiKey, verification, now: 20_000 };
    await expect(isWhisperAccountReady(params)).resolves.toBe(true);
    await expect(isWhisperAccountReady({ ...params, apiKey: 'changed-key' })).resolves.toBe(false);
    await expect(isWhisperAccountReady({ ...params, now: 10_000 + CONNECTION_VERIFICATION_TTL_MS + 1 })).resolves.toBe(false);
  });

  it('skips an account in persistent needs-retest health and accepts it after a successful re-test', async () => {
    const config = {
      slotId: 'pronunciation_scoring' as const,
      providerId: 'whisper_alignment',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3'
    };
    const apiKey = 'whisper-key-health';
    const fingerprint = await createProviderVerificationFingerprint(config, apiKey);
    if (!fingerprint) return;
    const params = {
      slotId: 'pronunciation_scoring' as const,
      account: 'primary' as const,
      config,
      apiKey,
      verification: {
        ok: true, providerId: 'whisper_alignment', tier: 2,
        testedAt: Date.now(), verificationFingerprint: fingerprint
      }
    };
    await markProviderAccountFailure('pronunciation_scoring', 'primary', Object.assign(new Error('HTTP 401'), { status: 401 }));
    await expect(isWhisperAccountReady(params)).resolves.toBe(false);
    await clearProviderAccountHealth('pronunciation_scoring', 'primary');
    await expect(isWhisperAccountReady(params)).resolves.toBe(true);
  });
});
