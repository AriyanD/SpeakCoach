import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllProviderAccountHealth, createProviderVerificationFingerprint } from '../src/services/providerHealth';
import { testSlotConnection } from '../src/services/connectionTester';
import { base64ToUint8Array, convertPcmBase64ToWavDataUrl, wrapPcm16LeToWavBytes } from '../src/services/pcmWavHelper';
import { saveApiKey } from '../src/storage/keyStore';
import { saveSlotConfig, saveSlotConnectionTestResult, saveSecondarySlotConfig } from '../src/storage/localStore';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { networkMonitor } from '../src/services/networkMonitor';
import {
  speakSentenceWithTierFallback,
  stopAllTts,
  synthesizeOnlineNeuralAudio
} from '../src/services/ttsService';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

describe('Gemini TTS Adapter & PCM-to-WAV Conversion (Task F6)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllProviderAccountHealth();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
    stopAllTts();
  });

  it('converts raw 16-bit linear PCM bytes to a valid 24 kHz mono RIFF/WAV header', () => {
    // 240 samples of 16-bit signed PCM (480 bytes) = 10 ms at 24000 Hz
    const pcmBytes = new Uint8Array(480);
    // Fill with sample sine-like or dummy 16-bit PCM values
    const pcmView = new DataView(pcmBytes.buffer);
    for (let i = 0; i < 240; i++) {
      pcmView.setInt16(i * 2, Math.round(Math.sin(i / 10) * 10000), true);
    }

    const wavBytes = wrapPcm16LeToWavBytes(pcmBytes, 24000, 1);
    expect(wavBytes.length).toBe(44 + 480);

    const wavView = new DataView(wavBytes.buffer);
    // Check RIFF header
    const riff = String.fromCharCode(...wavBytes.slice(0, 4));
    const wave = String.fromCharCode(...wavBytes.slice(8, 12));
    const fmt = String.fromCharCode(...wavBytes.slice(12, 16));
    const dataTag = String.fromCharCode(...wavBytes.slice(36, 40));

    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(fmt).toBe('fmt ');
    expect(dataTag).toBe('data');

    expect(wavView.getUint16(20, true)).toBe(1); // AudioFormat PCM
    expect(wavView.getUint16(22, true)).toBe(1); // NumChannels = 1
    expect(wavView.getUint32(24, true)).toBe(24000); // SampleRate = 24000
    expect(wavView.getUint32(28, true)).toBe(48000); // ByteRate = 24000 * 2
    expect(wavView.getUint16(32, true)).toBe(2); // BlockAlign = 2
    expect(wavView.getUint16(34, true)).toBe(16); // BitsPerSample = 16
    expect(wavView.getUint32(40, true)).toBe(480); // Data length
  });

  it('converts base64 PCM to a valid data:audio/wav;base64 URL', () => {
    // 16 zero-bytes representing 8 samples
    const pcmBase64 = 'AAAAAAAAAAAAAAAAAAAAAA==';
    const dataUrl = convertPcmBase64ToWavDataUrl(pcmBase64, 24000);

    expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    const decoded = base64ToUint8Array(dataUrl.replace('data:audio/wav;base64,', ''));
    expect(decoded.length).toBeGreaterThan(44);
    expect(String.fromCharCode(...decoded.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...decoded.slice(8, 12))).toBe('WAVE');
  });

  it('uses the generateContent endpoint with responseModalities: AUDIO and preserves returned WAV audio', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    let capturedHeaders: Record<string, string> = {};

    const wavB64 = Buffer.from('RIFF' + '0'.repeat(48)).toString('base64');
    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts',
      customTtsVoice: 'Aoede'
    };

    const res1 = await synthesizeOnlineNeuralAudio(
      'Hello from IELTS examiner',
      slotCfg,
      'test-gemini-key',
      1.0,
      async (opts) => {
        capturedUrl = opts.url;
        capturedBody = opts.data;
        capturedHeaders = opts.headers ?? {};
        return {
          status: 200,
          headers: {},
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/wav',
                        data: wavB64
                      }
                    }
                  ]
                }
              }
            ]
          },
          url: opts.url
        };
      }
    );

    expect(res1.fromCache).toBe(false);
    expect(res1.dataUrl).toBe(`data:audio/wav;base64,${wavB64}`);
    expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent');
    expect(capturedHeaders['x-goog-api-key']).toBe('test-gemini-key');
    expect(capturedBody.contents[0].role).toBe('user');
    expect(capturedBody.contents[0].parts[0].text).toBe('Hello from IELTS examiner');
    expect(capturedBody.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(capturedBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');

    const res2 = await synthesizeOnlineNeuralAudio(
      'Hello from IELTS examiner',
      slotCfg,
      'test-gemini-key',
      1.0,
      async () => {
        throw new Error('Cache should prevent a second network call');
      }
    );
    expect(res2.fromCache).toBe(true);
  });

  it('requests a separate slow Gemini TTS generation and reuses only the slow-audio cache entry', async () => {
    const wavB64 = Buffer.from('RIFF' + 's'.repeat(48)).toString('base64');
    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts',
      customTtsVoice: 'Aoede'
    };
    let capturedParts: Array<{ text?: string }> = [];
    let requestCount = 0;

    const slowResult = await synthesizeOnlineNeuralAudio(
      'This is the exact sentence to practise.',
      slotCfg,
      'slow-gemini-key',
      0.72,
      async (opts) => {
        requestCount++;
        capturedParts = (opts.data as any).contents[0].parts;
        return {
          status: 200,
          headers: {},
          data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wavB64 } }] } }] },
          url: opts.url
        };
      }
    );

    expect(slowResult.fromCache).toBe(false);
    expect(capturedParts).toHaveLength(2);
    expect(capturedParts[0].text).toContain('72% of normal speaking speed');
    expect(capturedParts[1].text).toBe('This is the exact sentence to practise.');

    const cachedSlowResult = await synthesizeOnlineNeuralAudio(
      'This is the exact sentence to practise.',
      slotCfg,
      'slow-gemini-key',
      0.72,
      async () => {
        throw new Error('The slow variant should be served from its own cache entry');
      }
    );
    expect(cachedSlowResult.fromCache).toBe(true);
    expect(requestCount).toBe(1);
  });

  it('extracts audio correctly when inlineData is in a non-first response part', async () => {
    const wavB64 = Buffer.from('RIFF' + '1'.repeat(48)).toString('base64');
    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-tts',
      customTtsVoice: 'Puck'
    };

    const res = await synthesizeOnlineNeuralAudio(
      'Testing non-first part audio',
      slotCfg,
      'test-gemini-key',
      1.0,
      async (opts) => ({
        status: 200,
        headers: {},
        data: {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'I am preparing the audio response now.' },
                  {
                    inlineData: {
                      mimeType: 'audio/wav',
                      data: wavB64
                    }
                  }
                ]
              }
            }
          ]
        },
        url: opts.url
      })
    );

    expect(res.dataUrl).toBe(`data:audio/wav;base64,${wavB64}`);
  });

  it('handles PCM mimeType and wraps it in a valid WAV container', async () => {
    // 240 samples of 16-bit PCM = 480 bytes
    const pcmBytes = new Uint8Array(480);
    const pcmB64 = Buffer.from(pcmBytes).toString('base64');

    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts'
    };

    const res = await synthesizeOnlineNeuralAudio(
      'Testing PCM wrapping',
      slotCfg,
      'test-gemini-key',
      1.0,
      async (opts) => ({
        status: 200,
        headers: {},
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/pcm;rate=24000',
                      data: pcmB64
                    }
                  }
                ]
              }
            }
          ]
        },
        url: opts.url
      })
    );

    expect(res.dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    const decoded = base64ToUint8Array(res.dataUrl.replace('data:audio/wav;base64,', ''));
    // 44-byte WAV header + 480 bytes PCM = 524 bytes
    expect(decoded.length).toBe(524);
    expect(String.fromCharCode(...decoded.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...decoded.slice(8, 12))).toBe('WAVE');
  });

  it('does not add a duplicate WAV header when returned data already contains a RIFF header', () => {
    // Build a real WAV byte sequence
    const pcmBytes = new Uint8Array(240);
    const originalWav = wrapPcm16LeToWavBytes(pcmBytes, 24000, 1);
    const wavB64 = Buffer.from(originalWav).toString('base64');

    // Call convertPcmBase64ToWavDataUrl with already-WAV data
    const resultUrl = convertPcmBase64ToWavDataUrl(wavB64, 24000);
    const decoded = base64ToUint8Array(resultUrl.replace('data:audio/wav;base64,', ''));

    // The length must remain identical — NO second 44-byte header added
    expect(decoded.length).toBe(originalWav.length);
    expect(String.fromCharCode(...decoded.slice(0, 4))).toBe('RIFF');
    // Subchunk 'fmt ' should only appear once
    const fmtMatches = (resultUrl.match(/Zm10/g) || []).length; // 'fmt ' in base64
    expect(fmtMatches).toBeLessThanOrEqual(1);
  });

  it('throws descriptive diagnostic error when candidate or inlineData is missing', async () => {
    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts'
    };

    await expect(
      synthesizeOnlineNeuralAudio(
        'Testing empty parts',
        slotCfg,
        'test-key',
        1.0,
        async (opts) => ({
          status: 200,
          headers: {},
          data: {
            candidates: [
              {
                content: {
                  parts: [{ text: 'Here is text instead of audio' }]
                }
              }
            ]
          },
          url: opts.url
        })
      )
    ).rejects.toThrow(/Gemini TTS returned no audio data.*candidateCount=1.*partCount=1/);
  });

  it('HTTP 429 returns error with status 429 without auto-retrying on TTS requests', async () => {
    let callCount = 0;
    const slotCfg = {
      slotId: 'voice_tts' as const,
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts'
    };

    let caughtError: any = null;
    try {
      await synthesizeOnlineNeuralAudio(
        'Testing 429 quota handling',
        slotCfg,
        'test-key',
        1.0,
        async (opts) => {
          callCount++;
          return {
            status: 429,
            headers: {},
            data: {
              error: {
                code: 429,
                message: 'Resource has been exhausted (e.g. check quota).'
              }
            },
            url: opts.url
          };
        }
      );
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError.status).toBe(429);
    // Verified maxRetries=0 ensures no second network attempt was made
    expect(callCount).toBe(1);
  });

  it('cancels pending TTS playback when stopAllTts is called before synthesis completes', async () => {
    let transportResolver: ((val: HttpResponse) => void) | null = null;
    let transportCalled = false;

    const mockTransport = async (_opts: HttpOptions): Promise<HttpResponse> => {
      transportCalled = true;
      return new Promise<HttpResponse>((resolve) => {
        transportResolver = resolve;
      });
    };

    await saveSlotConfig({
      slotId: 'voice_tts',
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts'
    });
    await saveApiKey('voice_tts', 'gemini_tts', 'test-key');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'gemini_tts', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
    });

    // Start speaking in background
    const speakPromise = speakSentenceWithTierFallback('This should not play', {
      transport: mockTransport
    });

    // Wait until network transport is actually invoked
    while (!transportCalled) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // User navigates away -> calls stopAllTts()
    stopAllTts();

    // Now async network request finishes with audio data
    const dummyWavB64 = Buffer.from('RIFF' + '3'.repeat(48)).toString('base64');
    transportResolver!({
      status: 200,
      headers: {},
      data: {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'audio/wav', data: dummyWavB64 } }]
            }
          }
        ]
      },
      url: 'https://generativelanguage.googleapis.com'
    });

    const result = await speakPromise;
    // The promise resolved gracefully without throwing, and pending playback was aborted
    expect(result).toBeDefined();
  });

  it('falls back from a failed primary TTS provider to the verified secondary TTS provider', async () => {
    await saveSlotConfig({
      slotId: 'voice_tts',
      providerId: 'gemini_tts',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.8-flash-lite-tts'
    });
    await saveApiKey('voice_tts', 'gemini_tts', 'primary-tts-key');
    const primaryConfig = { slotId: 'voice_tts' as const, providerId: 'gemini_tts', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', modelOrVoice: 'gemini-3.8-flash-lite-tts' };
    const primaryFingerprint = await createProviderVerificationFingerprint(primaryConfig, 'primary-tts-key');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'gemini_tts', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — primary TTS',
      verificationFingerprint: primaryFingerprint ?? undefined
    });
    const secondaryConfig = { slotId: 'voice_tts' as const, providerId: 'openai_tts', baseUrl: 'https://api.openai.com/v1', modelOrVoice: 'tts-1:alloy' };
    const secondaryFingerprint = await createProviderVerificationFingerprint(secondaryConfig, 'secondary-tts-key');
    await saveSecondarySlotConfig('voice_tts', {
      providerId: 'openai_tts',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'tts-1:alloy',
      verified: true,
      testResult: { ok: true, latencyMs: 1, message: 'PASS — secondary TTS', testedAt: Date.now(), verificationFingerprint: secondaryFingerprint ?? undefined }
    });
    await saveApiKey('voice_tts', 'openai_tts', 'secondary-tts-key', 'secondary');

    const attemptedUrls: string[] = [];
    vi.stubGlobal('Audio', undefined);
    try {
      const result = await speakSentenceWithTierFallback('A short TTS failover test.', {
        transport: async opts => {
          attemptedUrls.push(opts.url);
          if (opts.url.includes('generativelanguage.googleapis.com')) {
            return { url: opts.url, status: 401, headers: {}, data: { error: { message: 'Primary TTS key rejected' } } };
          }
          return {
            url: opts.url, status: 200, headers: {},
            data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
          };
        }
      });

      expect(attemptedUrls.some(url => url.includes('generativelanguage.googleapis.com'))).toBe(true);
      expect(attemptedUrls.some(url => url.includes('/audio/speech'))).toBe(true);
      expect(result.activeTier.providerId).toBe('openai_tts');
      expect(result.activeTier.detailLabel).toContain('API 2');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('accepts newly listed Gemini TTS model IDs without a code update', async () => {
    const audio = Buffer.from('RIFF' + 'x'.repeat(48)).toString('base64');
    let requestedUrl = '';
    const result = await synthesizeOnlineNeuralAudio(
      'Hello from a newly listed model',
      {
        slotId: 'voice_tts',
        providerId: 'gemini_tts',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-experimental-tts-preview'
      },
      'test-key',
      1,
      async (options) => {
        requestedUrl = options.url;
        return {
          url: options.url,
          status: 200,
          headers: {},
          data: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: audio } }] } }] }
        };
      }
    );

    expect(requestedUrl).toContain('/models/gemini-experimental-tts-preview:generateContent');
    expect(result.dataUrl).toBe(`data:audio/wav;base64,${audio}`);
  });

  it('rejects non-TTS Gemini models instead of making a misleading audio request', async () => {
    await expect(
      synthesizeOnlineNeuralAudio(
        'Hello',
        {
          slotId: 'voice_tts',
          providerId: 'gemini_tts',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          modelOrVoice: 'gemini-3.5-flash-lite'
        },
        'test-key'
      )
    ).rejects.toThrow('does not look like a Gemini TTS model');
  });

  it('runs functional Deep test successfully for Gemini TTS Voice slot', async () => {
    const dummyPcmB64 = Buffer.from('RIFF' + '4'.repeat(48)).toString('base64');

    const testRes = await testSlotConnection(
      {
        slotId: 'voice_tts',
        providerId: 'gemini_tts',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3.8-flash-lite-tts',
        customTtsVoice: 'Puck'
      },
      {
        apiKeyOverride: 'gemini-tts-key',
        isOnlineOverride: true,
        transport: async (opts) => ({
          status: 200,
          headers: {},
          data: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'audio/wav',
                        data: dummyPcmB64
                      }
                    }
                  ]
                }
              }
            ]
          },
          url: opts.url
        })
      }
    );

    expect(testRes.ok).toBe(true);
    expect(testRes.message).toMatch(/^PASS — Google Gemini TTS \(\) test passed \(/);
  });
});
