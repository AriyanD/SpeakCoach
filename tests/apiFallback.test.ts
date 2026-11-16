import { beforeEach, describe, expect, it } from 'vitest';
import type { SlotConfig, SlotId } from '../src/config/types';
import { getPreset } from '../src/config/providers';
import { requestAzurePronunciationAssessment, transcribeWithTier2WhisperOrFallback } from '../src/services/whisperSttService';
import { generateProbeWavBase64 } from '../src/services/connectionTester';
import { runWithSlotApiFallback } from '../src/services/apiFallback';
import { saveApiKey } from '../src/storage/keyStore';
import {
  loadAllSlotsConfig,
  saveSecondarySlotConfig,
  saveSlotConfig,
  saveSlotConnectionTestResult
} from '../src/storage/localStore';

const primaryConfig: SlotConfig = {
  slotId: 'llm_generator',
  providerId: 'gemini_gen',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  modelOrVoice: 'gemini-3.5-flash-lite'
};

describe('Per-slot secondary API fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const slotFallbackCases: Array<{
    slotId: SlotId;
    primaryProviderId: string;
    secondaryProviderId: string;
  }> = [
    { slotId: 'voice_tts', primaryProviderId: 'openai_tts', secondaryProviderId: 'elevenlabs_tts' },
    { slotId: 'pronunciation_scoring', primaryProviderId: 'whisper_alignment', secondaryProviderId: 'gemini_pronunciation' },
    { slotId: 'ielts_stt', primaryProviderId: 'whisper_stt', secondaryProviderId: 'gemini_stt' },
    { slotId: 'llm_evaluator', primaryProviderId: 'gemini_eval', secondaryProviderId: 'openai_compat_eval' },
    { slotId: 'llm_generator', primaryProviderId: 'gemini_gen', secondaryProviderId: 'openai_compat_gen' }
  ];

  it.each(slotFallbackCases)('tries API 2 after API 1 fails for $slotId', async ({ slotId, primaryProviderId, secondaryProviderId }) => {
    const primaryPreset = getPreset(slotId, primaryProviderId);
    const secondaryPreset = getPreset(slotId, secondaryProviderId);
    const primaryConfig: SlotConfig = {
      slotId,
      providerId: primaryPreset.id,
      baseUrl: primaryPreset.defaultBaseUrl,
      modelOrVoice: primaryPreset.defaultModelOrVoice
    };
    await saveSlotConfig(primaryConfig);
    await saveApiKey(slotId, primaryProviderId, 'primary-key');
    await saveSlotConnectionTestResult(slotId, {
      ok: true,
      slotId,
      providerId: primaryProviderId,
      tier: primaryPreset.tier,
      label: 'Online AI',
      latencyMs: 10,
      message: 'PASS — primary verified'
    });
    await saveSecondarySlotConfig(slotId, {
      providerId: secondaryPreset.id,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice,
      verified: true,
      testResult: { ok: true, latencyMs: 12, message: 'PASS — secondary verified', testedAt: 1000 }
    });
    await saveApiKey(slotId, secondaryProviderId, 'secondary-key', 'secondary');

    const attempted: string[] = [];
    const result = await runWithSlotApiFallback(slotId, primaryConfig, async (config, key) => {
      attempted.push(config.providerId);
      if (config.providerId === primaryProviderId) throw new Error('Simulated API 1 failure');
      expect(key).toBe('secondary-key');
      return 'result-from-api-2';
    });

    expect(attempted).toEqual([primaryProviderId, secondaryProviderId]);
    expect(result.account).toBe('secondary');
    expect(result.config.providerId).toBe(secondaryProviderId);
    expect(result.result).toBe('result-from-api-2');
  });

  it.each([
    { slotId: 'ielts_stt' as const, primaryProviderId: 'whisper_stt', secondaryProviderId: 'gemini_stt' },
    { slotId: 'pronunciation_scoring' as const, primaryProviderId: 'whisper_alignment', secondaryProviderId: 'gemini_pronunciation' }
  ])('rotates to the second speech provider after the first fails for $slotId', async ({ slotId, primaryProviderId, secondaryProviderId }) => {
    const primaryPreset = getPreset(slotId, primaryProviderId);
    const secondaryPreset = getPreset(slotId, secondaryProviderId);
    const primaryConfig: SlotConfig = {
      slotId,
      providerId: primaryPreset.id,
      baseUrl: primaryPreset.defaultBaseUrl,
      modelOrVoice: primaryPreset.defaultModelOrVoice
    };
    await saveSlotConfig(primaryConfig);
    await saveApiKey(slotId, primaryProviderId, 'primary-speech-key');
    await saveSlotConnectionTestResult(slotId, {
      ok: true, slotId, providerId: primaryProviderId, tier: primaryPreset.tier,
      label: 'Online AI', latencyMs: 10, message: 'PASS — primary verified'
    });
    await saveSecondarySlotConfig(slotId, {
      providerId: secondaryPreset.id,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice,
      verified: true,
      testResult: { ok: true, latencyMs: 12, message: 'PASS — secondary verified', testedAt: 1000 }
    });
    await saveApiKey(slotId, secondaryProviderId, 'secondary-speech-key', 'secondary');

    const requestedUrls: string[] = [];
    const outcome = await transcribeWithTier2WhisperOrFallback({
      slotId,
      wavBase64: generateProbeWavBase64(1, 440),
      durationMs: 1000,
      offlineTranscript: 'offline fallback transcript',
      transport: async opts => {
        requestedUrls.push(opts.url);
        if (opts.url.includes('/audio/transcriptions')) {
          return { url: opts.url, status: 503, headers: {}, data: { error: { message: 'API 1 unavailable' } } };
        }
        return {
          url: opts.url, status: 200, headers: {},
          data: { candidates: [{ content: { parts: [{ audioTranscription: { text: 'hello from the secondary speech provider' } }] } }] }
        };
      }
    });

    expect(requestedUrls.some(url => url.includes('/audio/transcriptions'))).toBe(true);
    expect(requestedUrls.some(url => url.includes(':generateContent'))).toBe(true);
    expect(outcome.transcript).toContain('hello from the secondary');
    expect(outcome.activeTier.providerId).toBe(secondaryProviderId);
  });

  it('labels both failed TTS attempts explicitly as API 1 and API 2', async () => {
    const preset = getPreset('voice_tts', 'openai_tts');
    const config: SlotConfig = {
      slotId: 'voice_tts', providerId: preset.id,
      baseUrl: preset.defaultBaseUrl, modelOrVoice: preset.defaultModelOrVoice
    };
    await saveSlotConfig(config);
    await saveApiKey('voice_tts', 'openai_tts', 'primary-key');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'openai_tts', tier: preset.tier,
      label: 'Online AI', latencyMs: 1, message: 'PASS — API 1 verified'
    });
    const secondary = getPreset('voice_tts', 'elevenlabs_tts');
    await saveSecondarySlotConfig('voice_tts', {
      providerId: secondary.id, baseUrl: secondary.defaultBaseUrl,
      modelOrVoice: secondary.defaultModelOrVoice, verified: true,
      testResult: { ok: true, latencyMs: 1, message: 'PASS — API 2 verified', testedAt: 1000 }
    });
    await saveApiKey('voice_tts', secondary.id, 'secondary-key', 'secondary');

    await expect(runWithSlotApiFallback('voice_tts', config, async (_cfg, key) => {
      throw new Error(key === 'primary-key' ? 'HTTP 429 quota exceeded' : 'HTTP 429 quota exceeded');
    })).rejects.toThrow(/API 1 \(primary\).*API 2 \(secondary\)/);
  });

  it('retries a verified secondary provider after a primary HTTP 503', async () => {
    await saveSlotConfig(primaryConfig);
    await saveApiKey('llm_generator', 'gemini_gen', 'primary-key');
    await saveSlotConnectionTestResult('llm_generator', {
      ok: true,
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      tier: 1,
      label: 'Online AI',
      latencyMs: 12,
      message: 'PASS — primary verified'
    });
    await saveSecondarySlotConfig('llm_generator', {
      providerId: 'openai_compat_gen',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'gpt-4o-mini',
      verified: true,
      testResult: {
        ok: true,
        latencyMs: 18,
        message: 'PASS — secondary verified',
        testedAt: 1000
      }
    });
    await saveApiKey('llm_generator', 'openai_compat_gen', 'secondary-key', 'secondary');

    const attempted: string[] = [];
    const result = await runWithSlotApiFallback('llm_generator', primaryConfig, async (config, key) => {
      attempted.push(config.providerId);
      if (config.providerId === 'gemini_gen') throw new Error('HTTP 503 — temporary overload');
      expect(key).toBe('secondary-key');
      return 'generated-by-secondary';
    });

    expect(attempted).toEqual(['gemini_gen', 'openai_compat_gen']);
    expect(result.result).toBe('generated-by-secondary');
    expect(result.account).toBe('secondary');
    expect(result.config.providerId).toBe('openai_compat_gen');
  });

  it('uses Azure Pronunciation Assessment as Slot 2 API 1 and falls back to API 2 when Azure rejects the request', async () => {
    const primaryPreset = getPreset('pronunciation_scoring', 'azure_pronunciation');
    const secondaryPreset = getPreset('pronunciation_scoring', 'gemini_pronunciation');
    const primaryConfig: SlotConfig = {
      slotId: 'pronunciation_scoring',
      providerId: primaryPreset.id,
      baseUrl: primaryPreset.defaultBaseUrl,
      modelOrVoice: 'en-US'
    };
    await saveSlotConfig(primaryConfig);
    await saveApiKey('pronunciation_scoring', 'azure_pronunciation', 'azure-primary-key');
    await saveSlotConnectionTestResult('pronunciation_scoring', {
      ok: true, slotId: 'pronunciation_scoring', providerId: 'azure_pronunciation', tier: 1,
      label: 'Online AI', latencyMs: 10, message: 'PASS — Azure verified'
    });
    await saveSecondarySlotConfig('pronunciation_scoring', {
      providerId: secondaryPreset.id,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice,
      verified: true,
      testResult: { ok: true, latencyMs: 12, message: 'PASS — secondary verified', testedAt: 1000 }
    });
    await saveApiKey('pronunciation_scoring', 'gemini_pronunciation', 'gemini-secondary-key', 'secondary');

    const attemptedUrls: string[] = [];
    const outcome = await transcribeWithTier2WhisperOrFallback({
      slotId: 'pronunciation_scoring',
      wavBase64: generateProbeWavBase64(1, 440),
      durationMs: 1000,
      referenceText: 'Hello from SpeakCoach.',
      offlineTranscript: 'offline fallback transcript',
      transport: async opts => {
        attemptedUrls.push(opts.url);
        if (opts.url.includes('/speech/recognition/conversation/cognitiveservices/v1')) {
          expect(opts.dataType).toBe('file');
          expect(opts.headers?.['Pronunciation-Assessment']).toBeTruthy();
          return { url: opts.url, status: 200, headers: {}, data: { RecognitionStatus: 'NoMatch' } };
        }
        return {
          url: opts.url, status: 200, headers: {},
          data: { candidates: [{ content: { parts: [{ audioTranscription: { text: 'hello from the secondary provider' } }] } }] }
        };
      }
    });

    expect(attemptedUrls.some(url => url.includes('/speech/recognition/conversation/cognitiveservices/v1'))).toBe(true);
    expect(attemptedUrls.some(url => url.includes(':generateContent'))).toBe(true);
    expect(outcome.transcript).toContain('hello from the secondary');
    expect(outcome.activeTier.providerId).toBe('gemini_pronunciation');
    expect(outcome.activeTier.detailLabel).toContain('API 2');
  });

  it('maps Azure pronunciation word scores and offsets into aligned speech tokens', async () => {
    const result = await requestAzurePronunciationAssessment({
      slotConfig: {
        slotId: 'pronunciation_scoring',
        providerId: 'azure_pronunciation',
        baseUrl: 'https://eastus.stt.speech.microsoft.com',
        modelOrVoice: 'en-US'
      },
      apiKey: 'azure-key',
      wavBase64: generateProbeWavBase64(1, 440),
      referenceText: 'Hello world.',
      transport: async opts => ({
        url: opts.url, status: 200, headers: {},
        data: {
          RecognitionStatus: 'Success',
          NBest: [{
            Lexical: 'hello world',
            Words: [
              { Word: 'hello', Offset: 1000000, Duration: 3000000, PronunciationAssessment: { AccuracyScore: 92 } },
              { Word: 'world', Offset: 4500000, Duration: 2500000, PronunciationAssessment: { AccuracyScore: 76 } }
            ]
          }]
        }
      })
    });
    expect(result.transcript).toBe('hello world');
    expect(result.words).toHaveLength(2);
    expect(result.words[0]).toMatchObject({ word: 'hello', startMs: 100, endMs: 400, confidence: 0.92 });
    expect(result.words[1].confidence).toBeCloseTo(0.76);
  });

  it('retains the secondary verified state and test snapshot in local storage', async () => {
    const snapshot = {
      ok: true,
      latencyMs: 31,
      message: 'PASS — API 2 test',
      testedAt: 123456
    };
    await saveSecondarySlotConfig('llm_generator', {
      providerId: 'openai_compat_gen',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'gpt-4o-mini',
      verified: true,
      testResult: snapshot
    });

    const stored = (await loadAllSlotsConfig()).llm_generator.secondary;
    expect(stored?.verified).toBe(true);
    expect(stored?.testResult).toEqual(snapshot);
  });

  it('explains when API 2 is skipped because it is no longer verified', async () => {
    await saveSlotConfig(primaryConfig);
    await saveApiKey('llm_generator', 'gemini_gen', 'primary-key');
    await saveSlotConnectionTestResult('llm_generator', {
      ok: true,
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      tier: 1,
      label: 'Online AI',
      latencyMs: 12,
      message: 'PASS — primary verified'
    });
    await saveSecondarySlotConfig('llm_generator', {
      providerId: 'openai_compat_gen',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'gpt-4o-mini',
      verified: false,
      testResult: {
        ok: false,
        latencyMs: 0,
        message: 'API 2 has not passed its test',
        testedAt: 123456
      }
    });

    await expect(
      runWithSlotApiFallback('llm_generator', primaryConfig, async () => {
        throw new Error('HTTP 503 — temporary overload');
      })
    ).rejects.toThrow(/API 2 has not passed its connection test/);
  });
});
