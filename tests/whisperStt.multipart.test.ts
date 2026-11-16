import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { describe, expect, it } from 'vitest';
import { generateProbeWavBase64, testSlotConnection } from '../src/services/connectionTester';
import {
  buildBinaryMultipartBody,
  buildCapacitorMultipartEntries,
  requestWhisperWordTimestamps,
  uint8ArrayToBinaryString,
  validateWavBase64
} from '../src/services/whisperSttService';
import { SLOT_DEFINITIONS } from '../src/config/providers';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.includes(',') ? value.split(',')[1] ?? '' : value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hasAsciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  return expected === String.fromCharCode(...bytes.slice(offset, offset + expected.length));
}

describe('Whisper WAV validation and Capacitor multipart serialization', () => {
  it('accepts a generated PCM WAV probe', () => {
    expect(() => validateWavBase64(generateProbeWavBase64())).not.toThrow();
  });

  it('rejects empty and header-only WAV payloads before uploading', () => {
    expect(() => validateWavBase64('')).toThrow('No recorded audio');
    const emptyWav = new Uint8Array(44);
    emptyWav.set(new TextEncoder().encode('RIFF'), 0);
    emptyWav.set(new TextEncoder().encode('WAVE'), 8);
    emptyWav.set(new TextEncoder().encode('data'), 36);
    expect(() => validateWavBase64(btoa(String.fromCharCode(...emptyWav)))).toThrow('contains no audio samples');
  });

  it('encodes WAV upload as a base64File entry for Capacitor native FormData', () => {
    const wav = generateProbeWavBase64();
    const entries = buildCapacitorMultipartEntries({
      fields: [{ name: 'model', value: 'whisper-large-v3-turbo' }],
      fileField: { name: 'file', filename: 'utterance.wav', contentType: 'audio/wav', dataBase64: `data:audio/wav;base64,${wav}` }
    });
    expect(entries[0]).toEqual({ type: 'string', key: 'model', value: 'whisper-large-v3-turbo' });
    expect(entries[1]).toMatchObject({
      type: 'base64File', key: 'file', fileName: 'utterance.wav', contentType: 'audio/wav'
    });
    const uploadedBytes = decodeBase64(entries[1].value);
    expect(hasAsciiAt(uploadedBytes, 0, 'RIFF')).toBe(true);
    expect(hasAsciiAt(uploadedBytes, 8, 'WAVE')).toBe(true);
  });
});

describe('Whisper multipart request contract', () => {
  it('sends a valid WAV using Capacitor formData entries and the STT timeout', async () => {
    const captured: HttpOptions[] = [];
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      captured.push(opts);
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { text: 'hello', words: [] },
        url: opts.url
      };
    };

    await requestWhisperWordTimestamps({
      slotConfig: {
        slotId: 'ielts_stt',
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      apiKey: 'gsk_test',
      wavBase64: generateProbeWavBase64(),
      transport: mockTransport
    });

    expect(captured).toHaveLength(1);
    const requestOptions = captured[0]!;
    expect(requestOptions.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(requestOptions.dataType).toBe('formData');
    expect(requestOptions.connectTimeout).toBe(60000);
    expect(requestOptions.readTimeout).toBe(60000);
    const entries = requestOptions.data as Array<Record<string, string>>;
    expect(entries).toContainEqual({ type: 'string', key: 'response_format', value: 'verbose_json' });
    expect(entries).toContainEqual({ type: 'string', key: 'timestamp_granularities[]', value: 'word' });
    const file = entries.find((entry) => entry.type === 'base64File');
    expect(file).toMatchObject({ type: 'base64File', key: 'file', fileName: 'utterance.wav', contentType: 'audio/wav' });
    const uploadedBytes = decodeBase64(file!.value);
    expect(hasAsciiAt(uploadedBytes, 0, 'RIFF')).toBe(true);
    expect(hasAsciiAt(uploadedBytes, 8, 'WAVE')).toBe(true);
  });

  it('connection tester submits the probe as a base64File FormData entry', async () => {
    const captured: HttpOptions[] = [];
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      captured.push(opts);
      return {
        status: 200,
        headers: {},
        data: { text: 'probe ok', words: [] },
        url: opts.url
      };
    };

    const result = await testSlotConnection(
      {
        slotId: 'ielts_stt',
        providerId: 'whisper_stt',
        baseUrl: 'https://api.groq.com/openai/v1',
        modelOrVoice: 'whisper-large-v3-turbo'
      },
      { apiKeyOverride: 'gsk_probe_key', isOnlineOverride: true, transport: mockTransport }
    );

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(1);
    const requestOptions = captured[0]!;
    expect(requestOptions.dataType).toBe('formData');
    const entries = requestOptions.data as Array<Record<string, string>>;
    const file = entries.find((entry) => entry.type === 'base64File');
    expect(file).toBeDefined();
    const uploadedBytes = decodeBase64(file!.value);
    expect(hasAsciiAt(uploadedBytes, 0, 'RIFF')).toBe(true);
    expect(hasAsciiAt(uploadedBytes, 8, 'WAVE')).toBe(true);
  });
});

describe('Binary multipart helper and Gemini preset defaults', () => {
  it('buildBinaryMultipartBody produces raw binary bytes without a base64 transfer header', () => {
    const boundary = 'TestBoundary123';
    const dataBase64 = btoa('RIFF');
    const bytes = buildBinaryMultipartBody({
      boundary,
      fields: [{ name: 'model', value: 'whisper-large-v3-turbo' }],
      fileField: { name: 'file', filename: 'utterance.wav', contentType: 'audio/wav', dataBase64 }
    });
    const body = uint8ArrayToBinaryString(bytes);
    expect(body).toContain(`--${boundary}`);
    expect(body).not.toContain('Content-Transfer-Encoding');
    expect(body).toContain('RIFF');
    expect(body).not.toContain(dataBase64);
    expect(body).toContain('Content-Type: audio/wav');
    expect(body).toContain('whisper-large-v3-turbo');
  });

  it('uses supported Gemini evaluator and generator preset defaults', () => {
    const evaluator = SLOT_DEFINITIONS.llm_evaluator.providers.find((provider) => provider.id === 'gemini_eval');
    const generator = SLOT_DEFINITIONS.llm_generator.providers.find((provider) => provider.id === 'gemini_gen');
    expect(evaluator?.defaultModelOrVoice).toBe('gemini-3.5-flash');
    expect(evaluator?.modelSuggestions).not.toContain('gemini-3.8-flash');
    expect(generator?.defaultModelOrVoice).toBe('gemini-3.5-flash-lite');
    expect(generator?.modelSuggestions).not.toContain('gemini-3.8-flash');
  });
});
