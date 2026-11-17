import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateProbeWavBase64, testSlotConnection } from '../src/services/connectionTester';
import { networkMonitor } from '../src/services/networkMonitor';
import {
  clearLastShadowingAttempt,
  recordLastShadowingAttempt
} from '../src/services/shadowingTelemetry';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import {
  parseWhisperWordTimestamps,
  requestWhisperWordTimestamps,
  transcribeWithTier2WhisperOrFallback
} from '../src/services/whisperSttService';
import { saveApiKey } from '../src/storage/keyStore';
import { saveSlotConfig } from '../src/storage/localStore';
import { clearDiagnosticsCache, renderDiagnosticsView } from '../src/ui/DiagnosticsView';

describe('Stage 2 Part 2A — Tier 2 Whisper STT Adapter & Word Timestamps', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    clearLastShadowingAttempt();
    clearDiagnosticsCache();
    networkMonitor.setOnline(true);
  });

  it('parses Groq/OpenAI verbose_json word-level timestamps and builds multipart request', async () => {
    let capturedOptions: HttpOptions | null = null;
    const mockGroqResponse = {
      text: 'The morning train leaves at eight.',
      duration: 2.15,
      words: [
        { word: 'The', start: 0.12, end: 0.28, probability: 0.98 },
        { word: 'morning', start: 0.3, end: 0.72, probability: 0.96 },
        { word: 'train', start: 0.75, end: 1.1, probability: 0.95 },
        { word: 'leaves', start: 1.14, end: 1.48, probability: 0.94 },
        { word: 'at', start: 1.5, end: 1.66, probability: 0.99 },
        { word: 'eight', start: 1.68, end: 2.05, probability: 0.97 }
      ]
    };

    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      capturedOptions = opts;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: mockGroqResponse,
        url: opts.url
      };
    };

    const res = await requestWhisperWordTimestamps({
      slotConfig: {
        slotId: 'ielts_stt',
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      apiKey: 'gsk_test_key_123',
      wavBase64: generateProbeWavBase64(),
      transport: mockTransport
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(capturedOptions!.headers?.Authorization).toBe('Bearer gsk_test_key_123');
    expect(capturedOptions!.dataType).toBe('formData');
    const entries = capturedOptions!.data as Array<Record<string, string>>;
    expect(entries).toContainEqual({ type: 'string', key: 'response_format', value: 'verbose_json' });
    expect(entries).toContainEqual({ type: 'string', key: 'timestamp_granularities[]', value: 'word' });
    expect(entries.find((entry) => entry.type === 'base64File')).toMatchObject({
      type: 'base64File', key: 'file', fileName: 'utterance.wav', contentType: 'audio/wav'
    });

    expect(res.transcript).toBe('The morning train leaves at eight.');
    expect(res.words).toHaveLength(6);
    expect(res.words[0]).toEqual({
      word: 'The',
      startMs: 120,
      endMs: 280,
      confidence: 0.98
    });
    expect(res.words[1].word).toBe('morning');
    expect(res.words[1].startMs).toBe(300);
    expect(res.words[1].endMs).toBe(720);
  });

  it('supports nested segment words in parseWhisperWordTimestamps and leaves confidence undefined when probability is absent (A1-3)', () => {
    const parsed = parseWhisperWordTimestamps({
      text: 'Hello world',
      segments: [
        {
          text: 'Hello world',
          words: [
            { word: 'Hello', start: 0.2, end: 0.55 },
            { word: 'world', start: 0.6, end: 1.05 }
          ]
        }
      ]
    });
    expect(parsed.words).toHaveLength(2);
    expect(parsed.words[0]).toMatchObject({ word: 'Hello', startMs: 200, endMs: 550 });
    expect(parsed.words[0].confidence).toBeUndefined();
    expect(parsed.words[1]).toMatchObject({ word: 'world', startMs: 600, endMs: 1050 });
    expect(parsed.words[1].confidence).toBeUndefined();
  });

  it('uses the transcription config and word timestamps with the dedicated Gemini Transcribe model', async () => {
    let capturedBody: any;
    const result = await requestWhisperWordTimestamps({
      slotConfig: {
        slotId: 'pronunciation_scoring',
        providerId: 'gemini_pronunciation',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3.5-transcribe'
      },
      apiKey: 'gemini-test-key',
      wavBase64: generateProbeWavBase64(),
      transport: async (opts: HttpOptions): Promise<HttpResponse> => {
        capturedBody = opts.data;
        return {
          status: 200,
          headers: {},
          data: { candidates: [{ content: { parts: [{ audioTranscription: { text: 'Hello there.', words: [
            { word: 'Hello', startOffset: '0.1s', endOffset: '0.4s' },
            { word: 'there.', startOffset: '0.5s', endOffset: '0.8s' }
          ] } }] } }] },
          url: opts.url
        };
      }
    });

    expect(capturedBody.generationConfig.audioTranscriptionConfig).toEqual({
      wordTimestamp: true, mode: 'VERBATIM'
    });
    expect(result.transcript).toBe('Hello there.');
    expect(result.words).toHaveLength(2);
  });

  it('omits transcription-only config when a general Gemini audio model is selected', async () => {
    let capturedBody: any;
    await requestWhisperWordTimestamps({
      slotConfig: {
        slotId: 'ielts_stt',
        providerId: 'gemini_stt',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3.8-flash'
      },
      apiKey: 'gemini-test-key',
      wavBase64: generateProbeWavBase64(),
      transport: async (opts: HttpOptions): Promise<HttpResponse> => {
        capturedBody = opts.data;
        return {
          status: 200,
          headers: {},
          data: { candidates: [{ content: { parts: [{ text: 'Hello there.' }] } }] },
          url: opts.url
        };
      }
    });

    expect(capturedBody.generationConfig).toEqual({ temperature: 0 });
  });

  it('tests connection for the STT slot (whisper_stt on Groq)', async () => {
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 200,
      headers: {},
      data: {
        text: 'test transcription',
        words: [{ word: 'test', start: 0.1, end: 0.5 }]
      },
      url: opts.url
    });

    const conn = await testSlotConnection(
      {
        slotId: 'ielts_stt',
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      {
        apiKeyOverride: 'gsk_valid_key',
        isOnlineOverride: true,
        transport: mockTransport
      }
    );

    expect(conn.ok).toBe(true);
    expect(conn.tier).toBe(2);
    expect(conn.label).toBe('Online AI');
    expect(conn.message).toContain('PASS');
  });

  it('automatically falls back to Tier 3 on Whisper endpoint error and displays raw word timestamps in Diagnostics', async () => {
    await saveSlotConfig({
      slotId: 'ielts_stt',
      providerId: 'whisper_stt',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3-turbo'
    });
    await saveApiKey('ielts_stt', 'whisper_stt', 'gsk_bad_key');

    const failingTransport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 503,
      headers: {},
      data: { error: { message: 'Groq Whisper overloaded' } },
      url: opts.url
    });

    const fallbackOutcome = await transcribeWithTier2WhisperOrFallback({
      slotId: 'ielts_stt',
      wavBase64: generateProbeWavBase64(),
      durationMs: 2000,
      offlineTranscript: 'The morning train leaves',
      offlineConfidence: 0.88,
      transport: failingTransport
    });

    // Verified auto-fallback to Tier 3
    expect(fallbackOutcome.activeTier.tier).toBe(3);
    expect(fallbackOutcome.activeTier.label).toBe('Basic offline');
    expect(fallbackOutcome.transcript).toBe('The morning train leaves');
    expect(fallbackOutcome.words).toHaveLength(4);
    expect(fallbackOutcome.words[0].startMs).toBeGreaterThanOrEqual(0);
    expect(fallbackOutcome.words[0].endMs).toBeGreaterThan(fallbackOutcome.words[0].startMs);

    // Record attempt with Whisper word timestamps and verify Diagnostics renders raw word list with start/end times
    await recordLastShadowingAttempt({
      referenceText: 'The morning train leaves at eight.',
      rawRecognizerText: fallbackOutcome.transcript,
      recognizerConfidence: 0.88,
      recognizerAlternatives: [],
      sttWordTimestamps: [
        { word: 'The', startMs: 120, endMs: 280, confidence: 0.98 },
        { word: 'morning', startMs: 300, endMs: 720, confidence: 0.96 },
        { word: 'train', startMs: 750, endMs: 1100, confidence: 0.95 },
        { word: 'leaves', startMs: 1140, endMs: 1480, confidence: 0.94 }
      ],
      sttActiveTierLabel: fallbackOutcome.activeTier.detailLabel,
      report: null
    });

    const container = document.createElement('div');
    await renderDiagnosticsView(container, '0.1.0', async () => {});

    const wordTsEl = container.querySelector('#diag-last-word-timestamps');
    expect(wordTsEl).not.toBeNull();
    expect(wordTsEl?.textContent).toContain('The [120–280 ms]');
    expect(wordTsEl?.textContent).toContain('morning [300–720 ms]');
    expect(wordTsEl?.textContent).toContain('train [750–1100 ms]');
    expect(wordTsEl?.textContent).toContain('leaves [1140–1480 ms]');
  });
});
