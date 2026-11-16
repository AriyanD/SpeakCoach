import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const secureValues = new Map<string, string>();
  const preferenceValues = new Map<string, string>();
  const isNativePlatform = vi.fn(() => false);
  const setSecureKey = vi.fn(async ({ keyId, value }: { keyId: string; value: string }) => {
    if (value) secureValues.set(keyId, value);
    else secureValues.delete(keyId);
    return { saved: true };
  });
  const getSecureKey = vi.fn(async ({ keyId }: { keyId: string }) => ({
    value: secureValues.get(keyId) ?? ''
  }));
  const setPreference = vi.fn(async ({ key, value }: { key: string; value: string }) => {
    preferenceValues.set(key, value);
  });
  const getPreference = vi.fn(async ({ key }: { key: string }) => ({
    value: preferenceValues.get(key) ?? null
  }));
  const removePreference = vi.fn(async ({ key }: { key: string }) => {
    preferenceValues.delete(key);
  });
  return {
    secureValues, preferenceValues, isNativePlatform,
    setSecureKey, getSecureKey, setPreference, getPreference, removePreference
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: mocks.isNativePlatform },
  registerPlugin: () => ({ setKey: mocks.setSecureKey, getKey: mocks.getSecureKey })
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: mocks.setPreference,
    get: mocks.getPreference,
    remove: mocks.removePreference
  }
}));

vi.mock('../src/services/tierManager', () => ({
  clearSlotRuntimeFailure: vi.fn()
}));

import { loadApiKey, loadApiKeyStrict, saveApiKey } from '../src/storage/keyStore';

const keyId = 'speakcoach.securekey.v1.voice_tts.openai_tts';

describe('API key storage safety and migration', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.secureValues.clear();
    mocks.preferenceValues.clear();
    mocks.isNativePlatform.mockReturnValue(false);
    mocks.setSecureKey.mockImplementation(async ({ keyId: id, value }) => {
      if (value) mocks.secureValues.set(id, value);
      else mocks.secureValues.delete(id);
      return { saved: true };
    });
    mocks.getSecureKey.mockImplementation(async ({ keyId: id }) => ({
      value: mocks.secureValues.get(id) ?? ''
    }));
    mocks.setPreference.mockImplementation(async ({ key, value }) => {
      mocks.preferenceValues.set(key, value);
    });
    mocks.getPreference.mockImplementation(async ({ key }) => ({
      value: mocks.preferenceValues.get(key) ?? null
    }));
    mocks.removePreference.mockImplementation(async ({ key }) => {
      mocks.preferenceValues.delete(key);
    });
  });

  it('persists and reads browser keys through verified Preferences storage', async () => {
    await saveApiKey('voice_tts', 'openai_tts', ' browser-secret ');
    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('browser-secret');
    expect(mocks.preferenceValues.get(keyId)).toBe('browser-secret');
  });

  it('migrates a legacy Android Preferences key only after secure read-back succeeds', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.preferenceValues.set(keyId, 'legacy-secret');

    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('legacy-secret');
    expect(mocks.secureValues.get(keyId)).toBe('legacy-secret');
    expect(mocks.preferenceValues.has(keyId)).toBe(false);
    expect(localStorage.getItem(keyId)).toBeNull();
  });

  it('retains the legacy key if migration to Android Keystore fails', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.preferenceValues.set(keyId, 'legacy-secret');
    mocks.setSecureKey.mockRejectedValue(new Error('Keystore unavailable'));

    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('legacy-secret');
    expect(mocks.preferenceValues.get(keyId)).toBe('legacy-secret');
  });

  it('does not fall back to plaintext storage when a native secure write fails', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.setSecureKey.mockResolvedValue({ saved: false });

    await expect(saveApiKey('voice_tts', 'openai_tts', 'new-secret'))
      .rejects.toThrow(/did not confirm.*saved securely/i);
    expect(mocks.preferenceValues.has(keyId)).toBe(false);
    expect(localStorage.getItem(keyId)).toBeNull();
  });

  it('verifies a native secure write before reporting success', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    await saveApiKey('voice_tts', 'openai_tts', 'secure-secret');
    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('secure-secret');
    expect(mocks.preferenceValues.has(keyId)).toBe(false);
  });

  it('stores primary and secondary provider credentials under separate secure identifiers', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    await saveApiKey('voice_tts', 'openai_tts', 'primary-secret');
    await saveApiKey('voice_tts', 'openai_tts', 'secondary-secret', 'secondary');

    expect(mocks.secureValues.get(keyId)).toBe('primary-secret');
    expect(mocks.secureValues.get(`${keyId}.secondary`)).toBe('secondary-secret');
    await expect(loadApiKeyStrict('voice_tts', 'openai_tts')).resolves.toBe('primary-secret');
    await expect(loadApiKeyStrict('voice_tts', 'openai_tts', 'secondary')).resolves.toBe('secondary-secret');
  });

  it('does not delete a legacy key when secure migration read-back does not match', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.preferenceValues.set(keyId, 'legacy-secret');
    mocks.setSecureKey.mockResolvedValue({ saved: true });
    mocks.getSecureKey
      .mockResolvedValueOnce({ value: '' })
      .mockResolvedValueOnce({ value: 'different-secret' });

    await expect(loadApiKeyStrict('voice_tts', 'openai_tts')).resolves.toBe('legacy-secret');
    expect(mocks.preferenceValues.get(keyId)).toBe('legacy-secret');
  });

  it('does not mistake a Keystore read failure for an unconfigured empty key', async () => {
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getSecureKey.mockRejectedValue(new Error('Keystore invalidated'));

    await expect(loadApiKeyStrict('voice_tts', 'openai_tts'))
      .rejects.toThrow(/restore it from an AI Settings backup/i);
    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('');
  });

});
