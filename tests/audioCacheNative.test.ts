import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { clearMemoryAudioCache, getCachedTtsAudio, setCachedTtsAudio } from '../src/services/audioCache';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) }
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    deleteFile: vi.fn()
  }
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    keys: vi.fn()
  }
}));

describe('native TTS file cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMemoryAudioCache();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Filesystem.mkdir).mockResolvedValue({ uri: 'cache://SpeakCoach/audio-cache' } as never);
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'cache://audio' } as never);
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(Filesystem.deleteFile).mockResolvedValue(undefined);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
    vi.mocked(Preferences.remove).mockResolvedValue(undefined);
    vi.mocked(Preferences.keys).mockResolvedValue({ keys: [] });
  });

  it('writes audio data to the app cache directory instead of Preferences', async () => {
    const audio = 'data:audio/wav;base64,QUJD';
    await setCachedTtsAudio('native-audio', audio);

    expect(Filesystem.mkdir).toHaveBeenCalledWith({
      path: 'SpeakCoach/audio-cache',
      directory: Directory.Cache,
      recursive: true
    });
    expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
      path: 'SpeakCoach/audio-cache/native-audio.txt',
      data: audio,
      directory: Directory.Cache,
      encoding: Encoding.UTF8
    }));
    expect(Preferences.set).toHaveBeenCalledTimes(1);
    expect(Preferences.set).toHaveBeenCalledWith(expect.objectContaining({
      key: 'speakcoach.tts.cache.v1.__index__'
    }));
  });

  it('lazily migrates an older Preferences audio entry to the file cache', async () => {
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => ({
      value: key === 'speakcoach.tts.cache.v1.legacy-audio'
        ? 'data:audio/wav;base64,TEVHQUNZ'
        : null
    }));

    await expect(getCachedTtsAudio('legacy-audio')).resolves.toBe('data:audio/wav;base64,TEVHQUNZ');
    expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
      path: 'SpeakCoach/audio-cache/legacy-audio.txt',
      data: 'data:audio/wav;base64,TEVHQUNZ'
    }));
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'speakcoach.tts.cache.v1.legacy-audio' });
  });
});
