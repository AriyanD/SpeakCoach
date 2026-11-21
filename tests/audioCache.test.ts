import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMemoryAudioCache,
  computeAudioCacheHash,
  createAudioCacheAccountFingerprint,
  getCachedTtsAudio,
  setCachedTtsAudio
} from '../src/services/audioCache';

describe('bounded TTS audio cache', () => {
  beforeEach(() => {
    localStorage.clear();
    clearMemoryAudioCache();
  });

  it('uses a stable content/provider hash', () => {
    const input = {
      providerId: 'gemini_tts',
      voiceOrModel: 'Kore',
      rate: 0.9,
      text: 'Hello there.'
    };
    expect(computeAudioCacheHash(input)).toBe(computeAudioCacheHash(input));
    expect(computeAudioCacheHash(input)).not.toBe(computeAudioCacheHash({ ...input, rate: 1 }));
  });

  it('uses a SHA-256-derived account fingerprint without exposing the API key', async () => {
    const first = await createAudioCacheAccountFingerprint('secret-api-key-one');
    const same = await createAudioCacheAccountFingerprint('secret-api-key-one');
    const other = await createAudioCacheAccountFingerprint('secret-api-key-two');

    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(same).toBe(first);
    expect(other).not.toBe(first);
    expect(first).not.toContain('secret-api-key-one');
  });

  it('stores and retrieves generated audio', async () => {
    await setCachedTtsAudio('audio-one', 'data:audio/wav;base64,QUJD');
    await expect(getCachedTtsAudio('audio-one')).resolves.toBe('data:audio/wav;base64,QUJD');
  });

  it('evicts least-recently-used entries after the persistent entry limit', async () => {
    for (let i = 0; i < 31; i++) {
      await setCachedTtsAudio(`entry-${i}`, `audio-${i}`);
    }
    await expect(getCachedTtsAudio('entry-0')).resolves.toBeNull();
    await expect(getCachedTtsAudio('entry-30')).resolves.toBe('audio-30');
  });

  it('does not persist an oversized audio item', async () => {
    const oversized = 'A'.repeat(2_000_001);
    await setCachedTtsAudio('oversized', oversized);
    await expect(getCachedTtsAudio('oversized')).resolves.toBeNull();
  });
});
