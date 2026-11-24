import { beforeEach, describe, expect, it } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { clearMemoryAudioCache, getCachedTtsAudio, setCachedTtsAudio } from '../src/services/audioCache';
import {
  activateShadowingAudioSet,
  initializeShadowingAudioStore,
  clearActiveShadowingAudioStore,
  getActiveShadowingAudioSet,
  persistActiveShadowingAudio,
  readActiveShadowingAudio,
  resetShadowingAudioStoreForTests,
  selectActiveSetAudioEvictions,
  markActiveSetAudioPlaying,
  releaseActiveSetAudioPlaying
} from '../src/services/shadowingAudioStore';

describe('durable active-set AI audio store', () => {
  beforeEach(() => {
    localStorage.clear();
    clearMemoryAudioCache();
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

  it('retains audio when switching sets and restores it on history re-entry', async () => {
    const firstGeneration = await activateShadowingAudioSet('en:easy:set-a');
    await setCachedTtsAudio('a', 'audio-a');
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
    await expect(getCachedTtsAudio('a')).resolves.toBe('audio-a');
    await expect(getActiveShadowingAudioSet()).resolves.toEqual({ setId: 'en:easy:set-b', generation: nextGeneration });
    await activateShadowingAudioSet('en:easy:set-a');
    await expect(readActiveShadowingAudio('a')).resolves.toBe('audio-a');
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


  it('defers eviction of a retained set until its generated audio finishes playing', async () => {
    const setId = 'en:easy:playing-set';
    const generation = await activateShadowingAudioSet(setId, { createdAt: 1 });
    await persistActiveShadowingAudio({ setId, generation, hash: 'currently-playing', dataUrl: 'playing-audio', kind: 'sentence' });
    const pathKey = 'speakcoach.shadowing.audio.SpeakCoach/shadowing-audio/en_easy_playing-set/currently-playing.txt';
    markActiveSetAudioPlaying(setId, 'currently-playing');
    for (const [id, createdAt] of [['set-b',2],['set-c',3],['set-d',4]] as const) {
      const nextGeneration = await activateShadowingAudioSet(id, { createdAt });
      await persistActiveShadowingAudio({ setId: id, generation: nextGeneration, hash: id, dataUrl: 'audio-'+id, kind: 'sentence' });
    }
    expect(localStorage.getItem(pathKey)).toBe('playing-audio');
    await releaseActiveSetAudioPlaying(setId, 'currently-playing');
    expect(localStorage.getItem(pathKey)).toBeNull();
  });

  it('keeps active-set sentence audio outside the generic 30-entry LRU', async () => {
    const setId = 'en:easy:lru-isolation';
    const generation = await activateShadowingAudioSet(setId);
    await persistActiveShadowingAudio({
      setId, generation, hash: 'protected-sentence',
      dataUrl: 'durable-sentence-audio', kind: 'sentence'
    });
    for (let i = 0; i < 35; i++) await setCachedTtsAudio(`generic-${i}`, `generic-audio-${i}`);
    await expect(readActiveShadowingAudio('protected-sentence', setId)).resolves.toBe('durable-sentence-audio');
  });


  it('removes orphan directories but retains every indexed set during startup reconciliation', async () => {
    const keptId = 'en:easy:retained';
    const gen = await activateShadowingAudioSet(keptId);
    await persistActiveShadowingAudio({ setId: keptId, generation: gen, hash: 'kept', dataUrl: 'kept-audio', kind: 'sentence' });
    const orphanKey = 'speakcoach.shadowing.audio.SpeakCoach/shadowing-audio/orphan-set/orphan.txt';
    localStorage.setItem(orphanKey, 'orphan-audio');
    resetShadowingAudioStoreForTests();
    await initializeShadowingAudioStore();
    expect(localStorage.getItem(orphanKey)).toBeNull();
    await activateShadowingAudioSet(keptId);
    await expect(readActiveShadowingAudio('kept')).resolves.toBe('kept-audio');
  });


  it('does not delete a replacement entry written under the same set while old audio is still playing', async () => {
    const setId = 'en:easy:playing-replacement';
    const generation = await activateShadowingAudioSet(setId);
    await persistActiveShadowingAudio({
      setId, generation, hash: 'same-hash', dataUrl: 'old-audio', kind: 'sentence'
    });
    markActiveSetAudioPlaying(setId, 'same-hash');
    await clearActiveShadowingAudioStore();
    const current = await getActiveShadowingAudioSet();
    await persistActiveShadowingAudio({
      setId, generation: current.generation, hash: 'same-hash',
      dataUrl: 'replacement-audio', kind: 'sentence'
    });
    await releaseActiveSetAudioPlaying(setId, 'same-hash');
    await expect(readActiveShadowingAudio('same-hash', setId)).resolves.toBe('replacement-audio');
  });


  it('migrates the v1 single-set index to v2 without moving audio files', async () => {
    const setId = 'en:easy:legacy';
    const file = 'SpeakCoach/shadowing-audio/en_easy_legacy/legacy-hash.txt';
    localStorage.setItem('speakcoach.shadowing.audio.SpeakCoach/shadowing-audio/en_easy_legacy/legacy-hash.txt', 'legacy-audio');
    await Preferences.set({ key: 'speakcoach.shadowing.audio-set-index.v1', value: JSON.stringify({
      setId, entries: [{ hash: 'legacy-hash', file, size: 12, createdAt: 1, kind: 'sentence' }]
    }) });
    await Preferences.set({ key: 'speakcoach.shadowing.audio-active-set.v1', value: setId });
    await initializeShadowingAudioStore();
    await expect(readActiveShadowingAudio('legacy-hash')).resolves.toBe('legacy-audio');
    await expect(Preferences.get({ key: 'speakcoach.shadowing.audio-set-index.v1' })).resolves.toEqual({ value: null });
    await expect(Preferences.get({ key: 'speakcoach.shadowing.audio-set-index.v2' })).resolves.toMatchObject({ value: expect.stringContaining('"version":2') });
  });

  it('evicts the oldest non-active audio set when a fourth set receives audio', async () => {
    const sets = ['set-1','set-2','set-3','set-4'];
    for (let i=0;i<sets.length;i++) {
      const id = sets[i], generation = await activateShadowingAudioSet(id, { createdAt: i + 1 });
      await persistActiveShadowingAudio({ setId:id, generation, hash:'h'+i, dataUrl:'audio-'+i, kind:'sentence' });
    }
    await activateShadowingAudioSet('set-1');
    await expect(readActiveShadowingAudio('h0')).resolves.toBeNull();
    await activateShadowingAudioSet('set-2');
    await expect(readActiveShadowingAudio('h1')).resolves.toBe('audio-1');
    await activateShadowingAudioSet('set-3');
    await expect(readActiveShadowingAudio('h2')).resolves.toBe('audio-2');
    await activateShadowingAudioSet('set-4');
    await expect(readActiveShadowingAudio('h3')).resolves.toBe('audio-3');
  });

  it('migrates legacy sets and clears all retained sets together', async () => {
    const a = await activateShadowingAudioSet('lang-a');
    await persistActiveShadowingAudio({ setId:'lang-a', generation:a, hash:'a', dataUrl:'audio-a', kind:'sentence' });
    const b = await activateShadowingAudioSet('lang-b');
    await persistActiveShadowingAudio({ setId:'lang-b', generation:b, hash:'b', dataUrl:'audio-b', kind:'sentence' });
    await clearActiveShadowingAudioStore();
    await activateShadowingAudioSet('lang-a');
    await expect(readActiveShadowingAudio('a')).resolves.toBeNull();
    await activateShadowingAudioSet('lang-b');
    await expect(readActiveShadowingAudio('b')).resolves.toBeNull();
  });

});
