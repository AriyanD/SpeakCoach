import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, normalizeBackupPayload, parseBackupJsonText, readBackupFile, restoreBackup } from '../src/services/dataBackup';
import { createDefaultAllSlotsConfig } from '../src/config/providers';
import { loadAllSlotsConfig, saveAllSlotsConfig } from '../src/storage/localStore';
import { loadAppSettings, saveAppSettings } from '../src/storage/appSettings';
import { loadApiKey, saveApiKey } from '../src/storage/keyStore';
import { getRecentLlmQuestions, getLlmSeenTopics, markLlmQuestionsSeen, markLlmTopicsSeen } from '../src/services/ieltsQuestionTracker';

beforeEach(() => {
  localStorage.clear();
});

describe('backup file compatibility', () => {
  it('reads JSON with a UTF-8 BOM and surrounding whitespace', () => {
    expect(parseBackupJsonText('\uFEFF  {"app":"SpeakCoach","type":"test-data","version":1}  ')).toEqual({
      app: 'SpeakCoach', type: 'test-data', version: 1
    });
  });

  it('reads a selected JSON File using the available browser file API', async () => {
    const backup = { app: 'SpeakCoach', type: 'test-data', version: 1, seenQuestions: {} };
    const file = new File([JSON.stringify(backup)], 'speakcoach-backup.json', { type: 'application/json' });
    await expect(readBackupFile(file)).resolves.toEqual(backup);
  });

  it('identifies the selected file when the browser reads it as empty', async () => {
    const file = new File([''], 'empty-backup.json', { type: 'application/json' });
    await expect(readBackupFile(file)).rejects.toThrow(/empty-backup\.json.*0 bytes.*cloud storage/i);
  });

  it('accepts a JSON string containing serialized backup JSON', () => {
    const inner = JSON.stringify({ app: 'SpeakCoach', type: 'test-data', version: 1, seenQuestions: {} });
    expect(parseBackupJsonText(JSON.stringify(inner))).toEqual(JSON.parse(inner));
  });

  it('accepts legacy unversioned SpeakCoach test-data backups', () => {
    expect(normalizeBackupPayload({ ielts: { history: [] }, seenQuestions: {} }, 'test-data')).toMatchObject({
      app: 'SpeakCoach', type: 'test-data', version: 1
    });
  });

  it('rejects backups carrying an unrelated former app label', () => {
    expect(() => normalizeBackupPayload({
      app: 'FormerApp',
      type: 'ai-settings',
      version: 1,
      configs: {}
    }, 'ai-settings')).toThrow(/different app/i);
  });

  it('does not mistake an AI-settings backup for a test-data backup', () => {
    expect(() => normalizeBackupPayload({
      app: 'SpeakCoach', type: 'ai-settings', version: 1, configs: {}
    }, 'test-data')).toThrow(/not a SpeakCoach test data backup/i);
  });

  it('rejects a backup from a newer app version with an actionable message', () => {
    expect(() => normalizeBackupPayload({
      app: 'SpeakCoach', type: 'test-data', version: 2
    }, 'test-data')).toThrow(/newer SpeakCoach version/i);
  });

  it('round-trips all AI provider settings through persistent storage', async () => {
    const source = createDefaultAllSlotsConfig();
    source.voice_tts = {
      ...source.voice_tts,
      providerId: 'openai_tts',
      baseUrl: 'https://backup.example.test/v1',
      modelOrVoice: 'tts-1:nova',
      speechRate: 0.9,
      secondary: {
        providerId: 'azure_tts',
        baseUrl: 'https://eastus.tts.speech.microsoft.com',
        modelOrVoice: 'en-US-JennyNeural',
        authStyle: 'bearer',
        verified: false
      }
    };
    source.llm_generator = {
      ...source.llm_generator,
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-backup-model',
      authStyle: 'query_param'
    };
    await saveAllSlotsConfig(source);
    await saveAppSettings({ allowBuiltinFallback: false, theme: 'dark', showQuestionText: true });
    await saveApiKey('voice_tts', 'openai_tts', 'voice-secret-key');
    await saveApiKey('voice_tts', 'azure_tts', 'voice-secondary-secret', 'secondary');
    await saveApiKey('llm_generator', 'gemini_gen', 'generator-secret-key');

    const backup = await createBackup('ai-settings');
    expect(backup.apiKeys).toMatchObject({
      voice_tts: { primary: 'voice-secret-key', secondary: 'voice-secondary-secret' },
      llm_generator: { primary: 'generator-secret-key' }
    });

    const changed = createDefaultAllSlotsConfig();
    changed.voice_tts = {
      ...changed.voice_tts,
      providerId: 'azure_tts',
      baseUrl: 'https://changed.example.test',
      modelOrVoice: 'en-US-JennyNeural'
    };
    await saveAllSlotsConfig(changed);
    await saveAppSettings({ allowBuiltinFallback: true });
    await saveApiKey('voice_tts', 'azure_tts', 'changed-key');
    await saveApiKey('llm_generator', 'gemini_gen', 'changed-generator-key');

    await restoreBackup('ai-settings', backup);

    const restored = await loadAllSlotsConfig();
    expect(restored.voice_tts).toMatchObject({
      providerId: 'openai_tts',
      baseUrl: 'https://backup.example.test/v1',
      modelOrVoice: 'tts-1:nova',
      speechRate: 0.9
    });
    expect(restored.llm_generator).toMatchObject({
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-backup-model',
      authStyle: 'query_param'
    });
    await expect(loadAppSettings()).resolves.toMatchObject({ allowBuiltinFallback: false, theme: 'dark', showQuestionText: true });
    await expect(loadApiKey('voice_tts', 'openai_tts')).resolves.toBe('voice-secret-key');
    await expect(loadApiKey('voice_tts', 'azure_tts', 'secondary')).resolves.toBe('voice-secondary-secret');
    await expect(loadApiKey('llm_generator', 'gemini_gen')).resolves.toBe('generator-secret-key');
  });

  it('rejects incomplete AI settings backups instead of silently importing a partial set', async () => {
    const before = await loadAllSlotsConfig();
    await expect(restoreBackup('ai-settings', {
      app: 'SpeakCoach',
      type: 'ai-settings',
      version: 1,
      configs: { voice_tts: before.voice_tts }
    })).rejects.toThrow(/missing the "pronunciation_scoring" provider settings/i);
    await expect(loadAllSlotsConfig()).resolves.toEqual(before);
  });

  it('creates a settings-only backup without API keys and preserves existing keys on restore', async () => {
    const configs = createDefaultAllSlotsConfig();
    await saveAllSlotsConfig(configs);
    await saveApiKey('voice_tts', configs.voice_tts.providerId, 'keep-existing-key');

    const backup = await createBackup('ai-settings', { includeApiKeys: false });
    expect(backup).not.toHaveProperty('apiKeys');

    await restoreBackup('ai-settings', backup);
    await expect(loadApiKey('voice_tts', configs.voice_tts.providerId)).resolves.toBe('keep-existing-key');
  });

  it('accepts legacy AI backups without API keys and leaves current keys untouched', async () => {
    const configs = createDefaultAllSlotsConfig();
    const legacy = {
      app: 'SpeakCoach',
      type: 'ai-settings',
      version: 1,
      configs,
      apiKeys: undefined
    };
    await restoreBackup('ai-settings', legacy);
    expect(await loadAllSlotsConfig()).toEqual(configs);
  });
});


describe('backup restore safety', () => {
  it('validates every API key entry before changing any provider settings', async () => {
    const before = await loadAllSlotsConfig();
    const beforeAppSettings = await loadAppSettings();
    await saveApiKey('voice_tts', before.voice_tts.providerId, 'keep-this-key');
    const invalid = {
      app: 'SpeakCoach',
      type: 'ai-settings',
      version: 1,
      configs: createDefaultAllSlotsConfig(),
      apiKeys: {
        voice_tts: { primary: 'replacement-key' }
      }
    };

    await expect(restoreBackup('ai-settings', invalid)).rejects.toThrow(/missing the API key entry/i);
    await expect(loadAllSlotsConfig()).resolves.toEqual(before);
    await expect(loadAppSettings()).resolves.toEqual(beforeAppSettings);
    await expect(loadApiKey('voice_tts', before.voice_tts.providerId)).resolves.toBe('keep-this-key');
  });

  it('backs up and restores recent AI-generated question memory across reinstalls', async () => {
    markLlmTopicsSeen(['Repair culture', 'Community gardens']);
    markLlmQuestionsSeen([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]);

    const backup = await createBackup('test-data');
    expect(backup.seenLlmTopics).toEqual(expect.arrayContaining(['Repair culture', 'Community gardens']));
    expect(backup.seenLlmQuestions).toEqual(expect.arrayContaining([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]));

    localStorage.clear();
    await restoreBackup('test-data', backup);
    expect(getLlmSeenTopics()).toEqual(expect.arrayContaining(['Repair culture', 'Community gardens']));
    expect(getRecentLlmQuestions()).toEqual(expect.arrayContaining([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]));
  });

  it('backs up and restores recent AI-generated question memory across reinstalls', async () => {
    markLlmTopicsSeen(['Repair culture', 'Community gardens']);
    markLlmQuestionsSeen([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]);

    const backup = await createBackup('test-data');
    expect(backup.seenLlmTopics).toEqual(expect.arrayContaining(['Repair culture', 'Community gardens']));
    expect(backup.seenLlmQuestions).toEqual(expect.arrayContaining([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]));

    localStorage.clear();
    await restoreBackup('test-data', backup);
    expect(getLlmSeenTopics()).toEqual(expect.arrayContaining(['Repair culture', 'Community gardens']));
    expect(getRecentLlmQuestions()).toEqual(expect.arrayContaining([
      'How do people learn to repair household objects?',
      'Should local communities maintain shared gardens?'
    ]));
  });

  it('includes generated question sets in test-data backups', async () => {
    const backup = await createBackup('test-data');
    expect(backup).toHaveProperty('ieltsQuestionSets');
    expect((backup.ieltsQuestionSets as { sets?: unknown[] }).sets).toEqual([]);
  });
});
