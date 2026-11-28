import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAllSlotsConfig } from '../src/config/providers';
import {
  getStorageRecoveryNotices,
  loadAllConnectionTestResults,
  loadAllSlotsConfig
} from '../src/storage/localStore';

describe('storage corruption recovery', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves malformed provider settings before using defaults', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', '{broken settings');
    await expect(loadAllSlotsConfig()).resolves.toEqual(createDefaultAllSlotsConfig());
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('speakcoach.storage_recovery.v1.speakcoach.slots.config.v1.'));
    expect(recoveryKey).toBeTruthy();
    expect(localStorage.getItem(recoveryKey!)).toBe('{broken settings');
    expect(getStorageRecoveryNotices().some(message => message.includes('speakcoach.slots.config.v1'))).toBe(true);
  });

  it('preserves malformed provider connection results instead of silently discarding them', async () => {
    localStorage.setItem('speakcoach.slots.connection_tests.v1', '{broken connection data');
    await expect(loadAllConnectionTestResults()).resolves.toEqual({});
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('speakcoach.storage_recovery.v1.speakcoach.slots.connection_tests.v1.'));
    expect(recoveryKey).toBeTruthy();
    expect(localStorage.getItem(recoveryKey!)).toBe('{broken connection data');
  });
});


describe('unknown provider ID recovery', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves an unrecognized provider ID and its custom endpoint instead of silently selecting offline', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      ielts_stt: {
        providerId: 'future_whisper_provider_v9',
        baseUrl: 'https://custom.example/v1',
        modelOrVoice: 'future-model',
        authStyle: 'bearer'
      }
    }));

    const configs = await loadAllSlotsConfig();
    expect(configs.ielts_stt).toMatchObject({
      providerId: 'future_whisper_provider_v9',
      baseUrl: 'https://custom.example/v1',
      modelOrVoice: 'future-model'
    });
    expect(getStorageRecoveryNotices().some(message =>
      message.includes('future_whisper_provider_v9') && message.includes('API key have been preserved')
    )).toBe(true);
  });

  it('preserves unknown secondary provider IDs as well', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      pronunciation_scoring: {
        providerId: 'whisper_alignment',
        baseUrl: 'https://api.openai.com/v1',
        modelOrVoice: 'whisper-1',
        secondary: {
          providerId: 'future_secondary_provider',
          baseUrl: 'https://secondary.example/v1',
          modelOrVoice: 'custom-model'
        }
      }
    }));

    const configs = await loadAllSlotsConfig();
    expect(configs.pronunciation_scoring.secondary?.providerId).toBe('future_secondary_provider');
    expect(getStorageRecoveryNotices().some(message => message.includes('future_secondary_provider'))).toBe(true);
  });
});
