import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAllSlotsConfig } from '../src/config/providers';

const keys = vi.hoisted(() => new Map<string, string>());
vi.mock('../src/storage/keyStore', () => ({
  loadApiKeyStrict: vi.fn(async (slot: string, provider: string, account = 'primary') =>
    (() => { const value = keys.get(`${slot}|${provider}|${account}`) ?? ''; if (value === '__READ_ERROR__') throw new Error('Keystore unavailable'); return value; })()
  ),
  saveApiKey: vi.fn(async (slot: string, provider: string, value: string, account = 'primary') => {
    keys.set(`${slot}|${provider}|${account}`, value);
  })
}));

import { migrateLegacyGroqWhisperConfigs } from '../src/storage/providerConfigMigration';

describe('legacy Groq Whisper credential migration', () => {
  beforeEach(() => keys.clear());

  it('copies the old primary key without deleting or overwriting credentials', async () => {
    const configs = createDefaultAllSlotsConfig();
    configs.ielts_stt.providerId = 'custom_openai_stt';
    configs.ielts_stt.baseUrl = 'https://api.groq.com/openai/v1';
    configs.ielts_stt.modelOrVoice = 'whisper-large-v3-turbo';
    keys.set('ielts_stt|whisper_stt|primary', 'legacy-secret');

    const changed = await migrateLegacyGroqWhisperConfigs(configs);

    expect(keys.get('ielts_stt|custom_openai_stt|primary')).toBe('legacy-secret');
    expect(keys.get('ielts_stt|whisper_stt|primary')).toBe('legacy-secret');
    expect(changed).toEqual([{ slotId: 'ielts_stt', account: 'primary' }]);
  });

  it('does not overwrite an existing Custom key with a different old key', async () => {
    const configs = createDefaultAllSlotsConfig();
    configs.pronunciation_scoring.providerId = 'custom_openai_pronunciation';
    configs.pronunciation_scoring.baseUrl = 'https://api.groq.com/openai/v1';
    configs.pronunciation_scoring.modelOrVoice = 'whisper-large-v3-turbo';
    keys.set('pronunciation_scoring|whisper_alignment|primary', 'legacy-secret');
    keys.set('pronunciation_scoring|custom_openai_pronunciation|primary', 'existing-custom-secret');

    const changed = await migrateLegacyGroqWhisperConfigs(configs);

    expect(keys.get('pronunciation_scoring|custom_openai_pronunciation|primary')).toBe('existing-custom-secret');
    expect(keys.get('pronunciation_scoring|whisper_alignment|primary')).toBe('legacy-secret');
    expect(changed).toEqual([]);
  });

  it('copies secondary-account keys independently', async () => {
    const configs = createDefaultAllSlotsConfig();
    configs.ielts_stt.secondary = {
      providerId: 'custom_openai_stt',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3-turbo'
    };
    keys.set('ielts_stt|whisper_stt|secondary', 'secondary-secret');

    const changed = await migrateLegacyGroqWhisperConfigs(configs);

    expect(keys.get('ielts_stt|custom_openai_stt|secondary')).toBe('secondary-secret');
    expect(changed).toEqual([{ slotId: 'ielts_stt', account: 'secondary' }]);
  });
});
