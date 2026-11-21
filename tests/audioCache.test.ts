import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMemoryAudioCache,
  computeAudioCacheHash,
  createAudioCacheAccountFingerprint,
  getCachedTtsAudio,
  setCachedTtsAudio,
  setMemoryOnlyTtsAudio
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
    if (!globalThis.crypto?.subtle) {
      await expect(createAudioCacheAccountFingerprint('secret-api-key-one')).resolves.toBeNull();
      return;
    }

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
  it('keeps prefetched entries in a reserved RAM budget when normal playback fills its own cache', async () => {
    const prefetchedOne = 'p'.repeat(1_500_000);
    const prefetchedTwo = 'q'.repeat(1_500_000);
    setMemoryOnlyTtsAudio('prefetch-one', prefetchedOne);
    setMemoryOnlyTtsAudio('prefetch-two', prefetchedTwo);

    await setCachedTtsAudio('normal-one', 'n'.repeat(1_500_000));
    await setCachedTtsAudio('normal-two', 'm'.repeat(1_500_000));

    await expect(getCachedTtsAudio('prefetch-one')).resolves.toBe(prefetchedOne);
    await expect(getCachedTtsAudio('prefetch-two')).resolves.toBe(prefetchedTwo);
  });

});
