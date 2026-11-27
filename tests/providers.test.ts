import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDefaultAllSlotsConfig,
  getOfflinePreset,
  getPreset,
  normalizeBaseUrl,
  SLOT_DEFINITIONS,
  SLOT_ORDER
} from '../src/config/providers';
import { hasConfiguredApiKey, loadApiKey, saveApiKey } from '../src/storage/keyStore';
import { loadAllSlotsConfig, loadSlotConnectionTestResult, saveSlotConfig } from '../src/storage/localStore';

describe('Provider Slots Configuration & Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defines all 6 required provider slots with at least one online and one offline Tier 3 provider', () => {
    expect(SLOT_ORDER).toHaveLength(6);
    for (const slotId of SLOT_ORDER) {
      const def = SLOT_DEFINITIONS[slotId];
      expect(def.providers.length).toBeGreaterThanOrEqual(2);
      const offline = getOfflinePreset(slotId);
      expect(offline.tier).toBe(3);
      expect(offline.requiresKey).toBe(false);
    }
  });

  it('uses Gemini as the default TTS provider while keeping Android Native hidden as a fallback preset', () => {
    const defaults = createDefaultAllSlotsConfig();
    expect(defaults.voice_tts.providerId).toBe('gemini_tts');
    expect(getPreset('voice_tts', 'android_native_tts').tier).toBe(3);
    expect(getPreset('voice_tts', 'gemini_tts').tier).toBe(1);
  });

  it('prefills the Speechify endpoint for JSON / Base64 TTS while allowing custom endpoints', () => {
    const speechify = getPreset('voice_tts', 'speechify_tts');
    expect(speechify.defaultBaseUrl).toBe('https://api.speechify.ai/v1');
    expect(speechify.baseUrlPlaceholder).toBe('https://api.speechify.ai/v1');
  });

  it('offers Groq WAV TTS and FreeTTS REST TTS without a model selector', () => {
    const groq = getPreset('voice_tts', 'groq_tts');
    const free = getPreset('voice_tts', 'freetts_tts');
    expect(groq.defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
    expect(groq.defaultModelOrVoice).toBe('canopylabs/orpheus-v1-english');
    expect(free.defaultBaseUrl).toBe('https://freetts.org');
    expect(free.defaultModelOrVoice).toBe('');
    expect(free.modelSuggestions).toEqual([]);
  });

  it('keeps the requested provider order and Groq defaults separate from standard OpenAI presets', () => {
    expect(SLOT_DEFINITIONS.voice_tts.providers.map(provider => provider.id)).toEqual([
      'openai_tts', 'custom_openai_tts', 'groq_tts', 'speechify_tts', 'freetts_tts',
      'azure_tts', 'elevenlabs_tts', 'gemini_tts', 'android_native_tts'
    ]);
    expect(SLOT_DEFINITIONS.pronunciation_scoring.providers.map(provider => provider.id)).toEqual([
      'azure_pronunciation', 'whisper_alignment', 'gemini_pronunciation',
      'custom_openai_pronunciation', 'offline_pronunciation'
    ]);
    expect(SLOT_DEFINITIONS.ielts_stt.providers.map(provider => provider.id)).toEqual([
      'whisper_stt', 'gemini_stt', 'custom_openai_stt', 'offline_stt'
    ]);
    expect(SLOT_DEFINITIONS.llm_evaluator.providers.map(provider => provider.id)).toEqual([
      'gemini_eval', 'openai_compat_eval', 'custom_openai_eval', 'offline_rule_eval'
    ]);
    expect(SLOT_DEFINITIONS.llm_generator.providers.map(provider => provider.id)).toEqual([
      'gemini_gen', 'openai_compat_gen', 'custom_openai_gen', 'offline_bank_gen'
    ]);
    expect(SLOT_DEFINITIONS.llm_translation.providers.map(provider => provider.id)).toEqual([
      'gemini_translation', 'openai_compat_translation', 'custom_openai_translation', 'offline_translation'
    ]);

    for (const [slotId, providerId] of [
      ['pronunciation_scoring', 'custom_openai_pronunciation'],
      ['ielts_stt', 'custom_openai_stt']
    ] as const) {
      const groq = getPreset(slotId, providerId);
      expect(groq.defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
      expect(groq.defaultModelOrVoice).toBe('whisper-large-v3-turbo');
    }
    for (const [slotId, providerId] of [
      ['llm_evaluator', 'custom_openai_eval'],
      ['llm_generator', 'custom_openai_gen'],
      ['llm_translation', 'custom_openai_translation']
    ] as const) {
      const groq = getPreset(slotId, providerId);
      expect(groq.defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
      expect(groq.defaultModelOrVoice).toBe('openai/gpt-oss-120b');
    }
    expect(getPreset('pronunciation_scoring', 'whisper_alignment')).toMatchObject({
      defaultBaseUrl: 'https://api.openai.com/v1', defaultModelOrVoice: 'whisper-1'
    });
    expect(getPreset('ielts_stt', 'whisper_stt')).toMatchObject({
      defaultBaseUrl: 'https://api.openai.com/v1', defaultModelOrVoice: 'whisper-1'
    });
  });

  it('migrates existing Groq Whisper configs and copies their API keys to the new Custom provider IDs', async () => {
    await saveApiKey('pronunciation_scoring', 'whisper_alignment', 'gsk-shadowing-legacy');
    await saveApiKey('ielts_stt', 'whisper_stt', 'gsk-ielts-legacy');
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      pronunciation_scoring: {
        providerId: 'whisper_alignment',
        baseUrl: 'https://api.groq.com/openai/v1/',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      ielts_stt: {
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3'
      }
    }));

    const loaded = await loadAllSlotsConfig();
    expect(loaded.pronunciation_scoring).toMatchObject({
      providerId: 'custom_openai_pronunciation',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3-turbo'
    });
    expect(loaded.ielts_stt).toMatchObject({
      providerId: 'custom_openai_stt',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3'
    });
    expect(await loadApiKey('pronunciation_scoring', 'custom_openai_pronunciation')).toBe('gsk-shadowing-legacy');
    expect(await loadApiKey('ielts_stt', 'custom_openai_stt')).toBe('gsk-ielts-legacy');
    // Old entries remain as a recovery copy; migration never deletes credentials.
    expect(await loadApiKey('pronunciation_scoring', 'whisper_alignment')).toBe('gsk-shadowing-legacy');
    expect(await loadApiKey('ielts_stt', 'whisper_stt')).toBe('gsk-ielts-legacy');
  });

  it('migrates API 2 Groq Whisper settings and invalidates stale provider verification', async () => {
    await saveApiKey('ielts_stt', 'whisper_stt', 'gsk-secondary-legacy', 'secondary');
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      ielts_stt: {
        providerId: 'gemini_stt',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3.5-transcribe',
        secondary: {
          providerId: 'whisper_stt',
          baseUrl: 'https://api.groq.com/openai/v1',
          modelOrVoice: 'whisper-large-v3-turbo',
          verified: true,
          testResult: { ok: true, latencyMs: 20, message: 'PASS', testedAt: Date.now() }
        }
      }
    }));
    localStorage.setItem('speakcoach.slots.connection_tests.v1', JSON.stringify({
      ielts_stt: {
        ok: true, slotId: 'ielts_stt', providerId: 'whisper_stt', tier: 2,
        label: 'Online AI', latencyMs: 20, message: 'PASS', timestamp: Date.now()
      }
    }));

    const loaded = await loadAllSlotsConfig();
    expect(loaded.ielts_stt.providerId).toBe('gemini_stt');
    expect(loaded.ielts_stt.secondary).toMatchObject({
      providerId: 'custom_openai_stt',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3-turbo',
      verified: false
    });
    expect(loaded.ielts_stt.secondary?.testResult).toBeUndefined();
    expect(await loadApiKey('ielts_stt', 'custom_openai_stt', 'secondary')).toBe('gsk-secondary-legacy');
    expect(await loadSlotConnectionTestResult('ielts_stt')).toBeNull();
  });

  it('does not overwrite an existing Custom API key or migrate a conflicting legacy Groq account', async () => {
    await saveApiKey('ielts_stt', 'whisper_stt', 'gsk-old-key');
    await saveApiKey('ielts_stt', 'custom_openai_stt', 'gsk-custom-key');
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      ielts_stt: {
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      }
    }));

    const loaded = await loadAllSlotsConfig();
    expect(loaded.ielts_stt.providerId).toBe('whisper_stt');
    expect(await loadApiKey('ielts_stt', 'whisper_stt')).toBe('gsk-old-key');
    expect(await loadApiKey('ielts_stt', 'custom_openai_stt')).toBe('gsk-custom-key');
  });

  it('does not migrate explicit OpenAI Whisper configurations or existing Custom settings', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      pronunciation_scoring: {
        providerId: 'whisper_alignment',
        baseUrl: 'https://api.openai.com/v1',
        modelOrVoice: 'whisper-1'
      },
      ielts_stt: {
        providerId: 'custom_openai_stt',
        baseUrl: 'https://my-stt.example.com/v1',
        modelOrVoice: 'my-custom-model'
      }
    }));
    const loaded = await loadAllSlotsConfig();
    expect(loaded.pronunciation_scoring).toMatchObject({
      providerId: 'whisper_alignment', baseUrl: 'https://api.openai.com/v1', modelOrVoice: 'whisper-1'
    });
    expect(loaded.ielts_stt).toMatchObject({
      providerId: 'custom_openai_stt', baseUrl: 'https://my-stt.example.com/v1', modelOrVoice: 'my-custom-model'
    });
  });

  it('normalizes trailing slashes from custom base URLs', () => {
    expect(normalizeBaseUrl('https://my-proxy.example.com/v1///')).toBe('https://my-proxy.example.com/v1');
    expect(normalizeBaseUrl('  https://api.openai.com/v1/  ')).toBe('https://api.openai.com/v1');
  });

  it('persists and sanitizes per-slot configuration in localStore', async () => {
    const defaults = createDefaultAllSlotsConfig();
    expect(defaults.llm_evaluator.providerId).toBe('gemini_eval');
    expect(defaults.llm_generator.providerId).toBe('gemini_gen');
    expect(defaults.llm_translation.providerId).toBe('gemini_translation');
    expect(getPreset('llm_translation', 'gemini_translation').defaultModelOrVoice).toBe('gemini-3.1-flash-lite');

    await saveSlotConfig({
      slotId: 'llm_evaluator',
      providerId: 'gemini_eval',
      baseUrl: 'https://my-gemini-gateway.example.org/v1beta/',
      modelOrVoice: 'gemini-2.5-pro'
    });

    const loaded = await loadAllSlotsConfig();
    expect(loaded.llm_evaluator.providerId).toBe('gemini_eval');
    expect(loaded.llm_evaluator.baseUrl).toBe('https://my-gemini-gateway.example.org/v1beta');
    expect(loaded.llm_evaluator.modelOrVoice).toBe('gemini-2.5-pro');
  });

  it('does not advertise a Vosk model that is not bundled with the app', () => {
    const offline = getPreset('pronunciation_scoring', 'offline_pronunciation');
    expect(offline.defaultModelOrVoice).toBe('android-offline');
    expect(offline.modelSuggestions).toEqual(['android-offline']);
    expect(offline.defaultBaseUrl).toBe('offline://android-speech-recognizer');
  });

  it('migrates previous official Gemini Translator defaults to Gemini 3.1 Flash Lite', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      llm_translation: {
        providerId: 'gemini_translation',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-flash-latest'
      }
    }));

    const loaded = await loadAllSlotsConfig();
    expect(loaded.llm_translation.modelOrVoice).toBe('gemini-3.1-flash-lite');
    const persisted = JSON.parse(localStorage.getItem('speakcoach.slots.config.v1') || '{}');
    expect(persisted.llm_translation.modelOrVoice).toBe('gemini-3.1-flash-lite');
  });


  it('preserves a user-selected Gemini translation model instead of migrating it', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', JSON.stringify({
      llm_translation: {
        providerId: 'gemini_translation',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3-flash-preview'
      }
    }));

    const loaded = await loadAllSlotsConfig();
    expect(loaded.llm_translation.modelOrVoice).toBe('gemini-3-flash-preview');
  });

  it('stores and retrieves API keys per slot and provider in keyStore', async () => {
    expect(await hasConfiguredApiKey('voice_tts', 'openai_tts')).toBe(false);

    await saveApiKey('voice_tts', 'openai_tts', '  sk-test-12345  ');
    expect(await loadApiKey('voice_tts', 'openai_tts')).toBe('sk-test-12345');
    expect(await hasConfiguredApiKey('voice_tts', 'openai_tts')).toBe(true);

    const preset = getPreset('voice_tts', 'openai_tts');
    expect(preset.tier).toBe(1);

    await saveApiKey('voice_tts', 'openai_tts', '');
    expect(await hasConfiguredApiKey('voice_tts', 'openai_tts')).toBe(false);
  });
});
