import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioRecorder } from '../src/services/audioRecorder';

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = true;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }>> }) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());

  constructor() {
    FakeSpeechRecognition.instance = this;
  }
}

afterEach(async () => {
  if (audioRecorder.isRecording()) await audioRecorder.stop();
  Reflect.deleteProperty(window, 'SpeechRecognition');
  FakeSpeechRecognition.instance = null;
});

describe('browser Shadowing speech recognition', () => {
  it('uses the selected locale and returns the browser transcript', async () => {
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition
    });

    await audioRecorder.start('sv-SE', { useOfflineRecognizer: true, preferOffline: true });
    const recognizer = FakeSpeechRecognition.instance;
    expect(recognizer?.lang).toBe('sv-SE');
    expect(recognizer?.start).toHaveBeenCalledOnce();

    recognizer?.onresult?.({
      results: [[{ transcript: 'Hej världen', confidence: 0.92 }]]
    });

    const result = await audioRecorder.stop();
    expect(result.offlineTranscript).toBe('Hej världen');
    expect(result.offlineConfidence).toBeCloseTo(0.92);
    expect(result.recognizerError).toBeUndefined();
  });

  it('reports when browser speech recognition is unavailable instead of silently returning English', async () => {
    await audioRecorder.start('fa-IR', { useOfflineRecognizer: true, preferOffline: true });
    const result = await audioRecorder.stop();
    expect(result.offlineTranscript).toBe('');
    expect(result.recognizerError).toContain('not available in this browser');
  });
});
