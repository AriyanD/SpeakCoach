import { beforeEach, describe, expect, it } from 'vitest';
import { clearMemoryAudioCache } from '../src/services/audioCache';
import { networkMonitor } from '../src/services/networkMonitor';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import {
  playAudioDataUrl,
  speakOfflineNativeTts,
  speakSentenceWithTierFallback,
  synthesizeOnlineNeuralAudio
} from '../src/services/ttsService';
import { IeltsSessionController } from '../src/services/ieltsSessionEngine';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';
import { audioRecorder } from '../src/services/audioRecorder';
import { saveApiKey } from '../src/storage/keyStore';
import { saveSlotConfig, saveSlotConnectionTestResult } from '../src/storage/localStore';

describe('Voice TTS Service (Online Neural Caching + Offline Native Fallback)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearMemoryAudioCache();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
  });

  it('uses Tier 3 Android Native TTS when no API key is configured', async () => {
    const res = await speakSentenceWithTierFallback(
      'I usually start my morning with a cup of hot coffee.',
      { rate: 1.0 }
    );
    expect(res.activeTier.tier).toBe(3);
    expect(res.activeTier.label).toBe('Basic offline');
    expect(res.fromCache).toBe(false);
    expect(res.durationEstimateMs).toBeGreaterThan(2000);
  });

  it('synthesizes online neural TTS and serves subsequent replays from local hash cache', async () => {
    await saveSlotConfig({
      slotId: 'voice_tts',
      providerId: 'openai_tts',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'tts-1:alloy'
    });
    await saveApiKey('voice_tts', 'openai_tts', 'sk-tts-live');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'openai_tts', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
    });

    let networkCalls = 0;
    const mockTransport = async (opts: { url: string }) => {
      networkCalls++;
      return {
        url: opts.url,
        status: 200,
        headers: {},
        data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
      };
    };

    const first = await speakSentenceWithTierFallback('Practice makes perfect.', {
      rate: 1.0,
      transport: mockTransport
    });
    expect(first.activeTier.tier).toBe(1);
    expect(first.activeTier.label).toBe('Online AI');
    expect(first.fromCache).toBe(false);
    expect(networkCalls).toBe(1);

    const second = await speakSentenceWithTierFallback('Practice makes perfect.', {
      rate: 1.0,
      transport: mockTransport
    });
    expect(second.activeTier.tier).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(networkCalls).toBe(1); // Zero extra network calls!
  }, 15000);

  it('uses the selected custom voice in the request and keeps different voices out of the same cache entry', async () => {
    const requests: any[] = [];
    const transport = async (opts: any) => {
      requests.push(opts.data);
      return {
        url: opts.url, status: 200, headers: {},
        data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
      };
    };
    const baseConfig = {
      slotId: 'voice_tts' as const,
      providerId: 'openai_tts',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'tts-1'
    };

    await synthesizeOnlineNeuralAudio('A different voice should be cached separately.', baseConfig, 'key', 1, transport);
    await synthesizeOnlineNeuralAudio('A different voice should be cached separately.', {
      ...baseConfig, customTtsVoice: 'shimmer'
    }, 'key', 1, transport);

    expect(requests.map((request) => request.voice)).toEqual(['alloy', 'shimmer']);
  });

  it('uses the selected API 2 Azure voice override in SSML', async () => {
    let requestBody = '';
    await synthesizeOnlineNeuralAudio('Hello from API 2.', {
      slotId: 'voice_tts',
      providerId: 'azure_tts',
      baseUrl: 'https://eastus.tts.speech.microsoft.com',
      modelOrVoice: 'en-US-JennyNeural',
      customTtsVoice: 'en-US-AriaNeural'
    }, 'azure-key', 1, async (opts: any) => {
      requestBody = String(opts.data);
      return {
        url: opts.url, status: 200, headers: {},
        data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
      };
    });

    expect(requestBody).toContain('<voice name=\'en-US-AriaNeural\'>');
  });

  it('uses the selected API 2 ElevenLabs voice ID override', async () => {
    let requestedUrl = '';
    await synthesizeOnlineNeuralAudio('Hello from API 2.', {
      slotId: 'voice_tts',
      providerId: 'elevenlabs_tts',
      baseUrl: 'https://api.elevenlabs.io/v1',
      modelOrVoice: 'old-voice-id:eleven_multilingual_v2',
      customTtsVoice: 'selected-voice-id'
    }, 'eleven-key', 1, async (opts: any) => {
      requestedUrl = opts.url;
      return {
        url: opts.url, status: 200, headers: {},
        data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
      };
    });

    expect(requestedUrl).toContain('/text-to-speech/selected-voice-id');
  });

  it('automatically falls back to Tier 3 Native TTS if the online TTS endpoint fails', async () => {
    await saveSlotConfig({
      slotId: 'voice_tts',
      providerId: 'azure_tts',
      baseUrl: 'https://eastus.tts.speech.microsoft.com',
      modelOrVoice: 'en-US-JennyNeural'
    });
    await saveApiKey('voice_tts', 'azure_tts', 'bad-key');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'azure_tts', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
    });

    const res = await speakSentenceWithTierFallback('Fallback test sentence.', {
      rate: 0.72,
      transport: async (opts) => ({
        url: opts.url,
        status: 401,
        headers: {},
        data: 'Unauthorized'
      })
    });

    expect(res.activeTier.tier).toBe(3);
    expect(res.activeTier.label).toBe('Basic offline');
    expect(res.activeTier.isFallback).toBe(true);
  });

  it('resolves playAudioDataUrl ONLY when audio finishes (onended/onerror), delaying IELTS cue beep and recording until playback ends (A2-2)', async () => {
    const OriginalAudio = globalThis.Audio;
    const OriginalSpeechSynth = window.speechSynthesis;
    const OriginalUtterance = globalThis.SpeechSynthesisUtterance;

    let triggerEnded: (() => void) | null = null;
    let triggerError: (() => void) | null = null;
    let playCalled = false;

    class MockAudio {
      public src: string;
      public playbackRate = 1.0;
      public onended: (() => void) | null = null;
      public onerror: (() => void) | null = null;
      private endedListeners: Array<() => void> = [];
      private errorListeners: Array<() => void> = [];

      constructor(src: string) {
        this.src = src;
        triggerEnded = () => {
          this.onended?.();
          this.endedListeners.forEach((fn) => fn());
        };
        triggerError = () => {
          this.onerror?.();
          this.errorListeners.forEach((fn) => fn());
        };
      }

      addEventListener(type: string, cb: () => void) {
        if (type === 'ended') this.endedListeners.push(cb);
        if (type === 'error') this.errorListeners.push(cb);
      }

      play(): Promise<void> {
        playCalled = true;
        return Promise.resolve();
      }

      pause() {}
    }

    (globalThis as unknown as { Audio: unknown }).Audio = MockAudio;

    try {
      // 1. Direct playAudioDataUrl waits for onended, NOT play() resolution
      let resolved = false;
      const playPromise = playAudioDataUrl('data:audio/mp3;base64,AAAA', 1.0).then(() => {
        resolved = true;
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(playCalled).toBe(true);
      expect(resolved).toBe(false);

      triggerEnded!();
      await playPromise;
      expect(resolved).toBe(true);

      // 2. Also resolves cleanly on onerror
      let errorResolved = false;
      const errPromise = playAudioDataUrl('data:audio/mp3;base64,BBBB', 1.0).then(() => {
        errorResolved = true;
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(errorResolved).toBe(false);
      triggerError!();
      await errPromise;
      expect(errorResolved).toBe(true);

      // 3. IELTS examiner prompt: cue_tone and recording do NOT start until TTS audio finishes
      await saveSlotConfig({
        slotId: 'voice_tts',
        providerId: 'openai_tts',
        baseUrl: 'https://api.openai.com/v1',
        modelOrVoice: 'tts-1:alloy'
      });
      await saveApiKey('voice_tts', 'openai_tts', 'sk-tts-live');
      await saveSlotConnectionTestResult('voice_tts', {
        ok: true, slotId: 'voice_tts', providerId: 'openai_tts', tier: 1,
        label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
      });

      const ctrl = new IeltsSessionController({ mode: 'part1', plan: generateIeltsSessionPlan() });
      const firstQuestion = ctrl.getSnapshot().currentStep!.questionText;

      // Pre-warm audio cache for firstQuestion using a fast ending mock audio
      const origCtor = (globalThis as unknown as { Audio: unknown }).Audio;
      (globalThis as unknown as { Audio: unknown }).Audio = class {
        public onended: (() => void) | null = null;
        play() {
          queueMicrotask(() => this.onended?.());
          return Promise.resolve();
        }
      };
      await speakSentenceWithTierFallback(firstQuestion, {
        rate: 1.0,
        transport: async (opts) => ({
          url: opts.url,
          status: 200,
          headers: {},
          data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA'
        })
      });
      (globalThis as unknown as { Audio: unknown }).Audio = origCtor;

      const promptPromise = ctrl.startStepExaminerPrompt();

      await new Promise((r) => setTimeout(r, 30));
      // While audio is still playing (onended not fired yet), status MUST remain examiner_speaking
      expect(ctrl.getSnapshot().status).toBe('examiner_speaking');
      expect(audioRecorder.isRecording()).toBe(false);

      // Now finish audio playback -> cue beep plays and recording starts
      triggerEnded!();
      await promptPromise;
      expect(ctrl.getSnapshot().activeVoiceTier?.tier).toBe(1);
      expect(ctrl.getSnapshot().activeVoiceTier?.providerId).toBe('openai_tts');
      expect(ctrl.getSnapshot().status).toBe('recording');
      expect(audioRecorder.isRecording()).toBe(true);
      await audioRecorder.stop();
      ctrl.clearAllTimers();

      // 4. Web speechSynthesis fallback also waits for utterance onend
      let utterEnd: (() => void) | null = null;
      (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
        class {
          public text: string;
          public lang = 'en-US';
          public rate = 1.0;
          public onend: (() => void) | null = null;
          public onerror: (() => void) | null = null;
          constructor(text: string) {
            this.text = text;
            utterEnd = () => this.onend?.();
          }
        };
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel: () => {},
          speak: () => {}
        }
      });

      let synthResolved = false;
      const synthPromise = speakOfflineNativeTts('Hello world', 'en-US', 1.0).then(() => {
        synthResolved = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      expect(synthResolved).toBe(false);
      utterEnd!();
      await synthPromise;
      expect(synthResolved).toBe(true);
    } finally {
      (globalThis as unknown as { Audio: unknown }).Audio = OriginalAudio;
      (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
        OriginalUtterance;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: OriginalSpeechSynth
      });
    }
  }, 15000);
});
