import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateShadowingAudioSet,
  clearActiveShadowingAudioStore,
  getActiveShadowingAudioSet,
  persistActiveShadowingAudio,
  readActiveShadowingAudio,
  resetShadowingAudioStoreForTests,
  selectActiveSetAudioEvictions
} from '../src/services/shadowingAudioStore';

describe('durable active-set AI audio store', () => {
  beforeEach(() => {
    localStorage.clear();
    resetShadowingAudioStoreForTests();
  });

  it('persists generated sentence audio and restores it after module state is restarted', async () => {
    const generation = await activateShadowingAudioSet('en:easy:ai-set-1');
    await expect(persistActiveShadowingAudio({
      setId: 'en:easy:ai-set-1', generation, hash: 'sentence-hash',
      dataUrl: 'data:audio/wav;base64,QUJD', kind: 'sentence'
    })).resolves.toBe(true);
    resetShadowingAudioStoreForTests();

    await activateShadowingAudioSet('en:easy:ai-set-1');
    await expect(readActiveShadowingAudio('sentence-hash')).resolves.toBe('data:audio/wav;base64,QUJD');
  });

  it('deletes the previous set on a real set switch, but preserves a same-set re-entry', async () => {
    const firstGeneration = await activateShadowingAudioSet('en:easy:set-a');
    await persistActiveShadowingAudio({
      setId: 'en:easy:set-a', generation: firstGeneration, hash: 'a',
      dataUrl: 'audio-a', kind: 'sentence'
    });
    const sameGeneration = await activateShadowingAudioSet('en:easy:set-a');
    expect(sameGeneration).toBe(firstGeneration);
    await expect(readActiveShadowingAudio('a')).resolves.toBe('audio-a');

    const nextGeneration = await activateShadowingAudioSet('en:easy:set-b');
    expect(nextGeneration).toBeGreaterThan(firstGeneration);
    await expect(readActiveShadowingAudio('a')).resolves.toBeNull();
    await expect(getActiveShadowingAudioSet()).resolves.toEqual({
      setId: 'en:easy:set-b', generation: nextGeneration
    });
  });

  it('discards a stale synthesis result that finishes after the active set changed', async () => {
    const staleGeneration = await activateShadowingAudioSet('en:easy:old');
    await activateShadowingAudioSet('en:easy:new');
    await expect(persistActiveShadowingAudio({
      setId: 'en:easy:old', generation: staleGeneration, hash: 'stale',
      dataUrl: 'old-audio', kind: 'sentence'
    })).resolves.toBe(false);
    await expect(readActiveShadowingAudio('stale')).resolves.toBeNull();
  });

  it('can clear active-set audio without touching user recording storage', async () => {
    const generation = await activateShadowingAudioSet('en:easy:set-a');
    await persistActiveShadowingAudio({
      setId: 'en:easy:set-a', generation, hash: 'generated',
      dataUrl: 'ai-generated-audio', kind: 'sentence'
    });
    localStorage.setItem('speakcoach.user-recording.fixture', 'user-recording');
    await clearActiveShadowingAudioStore();
    await expect(readActiveShadowingAudio('generated')).resolves.toBeNull();
    expect(localStorage.getItem('speakcoach.user-recording.fixture')).toBe('user-recording');
  });
  it('evicts slow/replay extras before sentence audio and never selects sentence entries', () => {
    const entries = [
      { hash: 'sentence-1', size: 60, createdAt: 1, kind: 'sentence' as const },
      { hash: 'slow-1', size: 30, createdAt: 2, kind: 'extra' as const },
      { hash: 'word-1', size: 25, createdAt: 3, kind: 'extra' as const },
      { hash: 'sentence-2', size: 50, createdAt: 4, kind: 'sentence' as const }
    ];
    expect(selectActiveSetAudioEvictions(entries, 40, 180)).toEqual(['slow-1']);
    expect(selectActiveSetAudioEvictions(entries, 100, 170)).toEqual(['slow-1', 'word-1']);
  });

});
