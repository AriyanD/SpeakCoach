import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearModelTimingCache,
  deriveModelTimingsFromWhisper,
  getCachedModelWordTimings,
  setCachedModelWordTimings
} from '../src/services/modelTimingService';
import { scoreShadowingTier2 } from '../src/services/shadowingScorer';
import { generateProbeWavBase64 } from '../src/services/connectionTester';

describe('Model TTS Word-Timestamp Service & Cache', () => {
  beforeEach(() => {
    localStorage.clear();
    clearModelTimingCache();
  });

  it('sets and retrieves cached model word timings', async () => {
    const text = 'The morning train arrives early.';
    const mockTimings = [
      {
        index: 0,
        word: 'The',
        normalized: 'the',
        expectedStartMs: 0,
        expectedDurationMs: 250,
        expectedEndMs: 250,
        expectedShare: 0.12
      },
      {
        index: 1,
        word: 'morning',
        normalized: 'morning',
        expectedStartMs: 260,
        expectedDurationMs: 600,
        expectedEndMs: 860,
        expectedShare: 0.29
      }
    ];

    await setCachedModelWordTimings(text, mockTimings, 'test-voice');
    const cached = await getCachedModelWordTimings(text, 'test-voice');
    expect(cached).toHaveLength(2);
    expect(cached![0].word).toBe('The');
    expect(cached![0].expectedDurationMs).toBe(250);
  });

  it('derives expected word durations from model audio via Whisper and caches it', async () => {
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        text: 'The morning train',
        words: [
          { word: 'The', start: 0.1, end: 0.35 },
          { word: 'morning', start: 0.36, end: 0.95 },
          { word: 'train', start: 0.96, end: 1.45 }
        ]
      },
      url: opts.url
    });

    const derived = await deriveModelTimingsFromWhisper({
      text: 'The morning train',
      audioBase64: generateProbeWavBase64(),
      slotConfig: {
        slotId: 'ielts_stt',
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      apiKey: 'gsk_test',
      transport: mockTransport
    });

    expect(derived).toHaveLength(3);
    expect(derived[0].word).toBe('The');
    expect(derived[0].expectedDurationMs).toBe(250);
    expect(derived[1].word).toBe('morning');
    expect(derived[1].expectedDurationMs).toBe(590);

    // Verify it was cached
    const cached = await getCachedModelWordTimings('The morning train', 'whisper-large-v3-turbo');
    expect(cached).toHaveLength(3);

    // Score repetition using model-derived word timings as override
    const report = scoreShadowingTier2({
      referenceText: 'The morning train',
      spokenTranscript: 'The morning train',
      spokenTokens: [
        { word: 'The', startMs: 0, endMs: 250, confidence: 0.95 },
        { word: 'morning', startMs: 260, endMs: 850, confidence: 0.95 },
        { word: 'train', startMs: 860, endMs: 1350, confidence: 0.95 }
      ],
      spokenDurationMs: 1350,
      expectedDurationMs: 1350,
      referenceTimingsOverride: derived
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(90);
    expect(report.words.every((w) => w.speedLabel === 'OK')).toBe(true);
  });
});
