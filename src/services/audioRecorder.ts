import { Capacitor, registerPlugin } from '@capacitor/core';

export interface RecognizerAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeakCoachSpeechPluginInterface {
  ensureMicPermission(): Promise<{ granted: boolean }>;
  startRecording(options: {
    locale?: string;
    useOfflineRecognizer?: boolean;
    preferOffline?: boolean;
  }): Promise<{ started: boolean }>;
  stopRecording(): Promise<{
    wavBase64: string;
    durationMs: number;
    sampleRate: number;
    offlineTranscript: string;
    offlineConfidence: number;
    offlineAlternatives?: RecognizerAlternative[];
    recognizerError?: string;
  }>;
}

export interface RecordedUtterance {
  wavBase64: string;
  wavDataUrl: string;
  durationMs: number;
  sampleRate: number;
  offlineTranscript: string;
  offlineConfidence: number;
  offlineAlternatives: RecognizerAlternative[];
  recognizerError?: string;
}

const SpeakCoachSpeechNative = registerPlugin<SpeakCoachSpeechPluginInterface>('SpeakCoachSpeech');

export async function requestNativeMicPermission(): Promise<boolean> {
  const res = await SpeakCoachSpeechNative.ensureMicPermission();
  return Boolean(res?.granted);
}

export function encodeFloat32ToWav16kMonoBytes(
  samples: Float32Array,
  inputSampleRate = 16000
): Uint8Array {
  const targetRate = 16000;
  let resampled = samples;

  if (inputSampleRate !== targetRate && inputSampleRate > 0 && samples.length > 0) {
    const ratio = inputSampleRate / targetRate;
    const outLen = Math.max(1, Math.round(samples.length / ratio));
    resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = Math.min(samples.length - 1, Math.floor(i * ratio));
      resampled[i] = samples[srcIdx];
    }
  }

  const pcmByteLen = resampled.length * 2;
  const buffer = new ArrayBuffer(44 + pcmByteLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmByteLen, true);

  let offset = 44;
  for (let i = 0; i < resampled.length; i++) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

class AudioRecorderService {
  private active = false;
  private permissionRequestInProgress = false;
  private startMs = 0;
  private activeCaptureMode: 'online_wav' | 'offline_recognizer' = 'offline_recognizer';
  private lastStartOptions: {
    locale: string;
    useOfflineRecognizer: boolean;
    preferOffline: boolean;
  } | null = null;
  private webStream: MediaStream | null = null;
  private webContext: AudioContext | null = null;
  private webProcessor: ScriptProcessorNode | null = null;
  private webChunks: Float32Array[] = [];
  private webSampleRate = 16000;
  private mockRecognizerOutput: {
    transcript: string;
    confidence: number;
    alternatives?: RecognizerAlternative[];
    error?: string;
  } | null = null;

  /**
   * Used ONLY by unit tests to inject a simulated recognizer output.
   * Never populated with reference text in production.
   */
  public setMockRecognizerOutputForTest(
    mock: {
      transcript: string;
      confidence?: number;
      alternatives?: RecognizerAlternative[];
      error?: string;
    } | null
  ): void {
    this.mockRecognizerOutput = mock
      ? {
          transcript: mock.transcript,
          confidence:
            typeof mock.confidence === 'number' && mock.confidence > 0 ? mock.confidence : 0,
          alternatives: mock.alternatives,
          error: mock.error
        }
      : null;
  }

  public isRecording(): boolean {
    return this.active;
  }

  /** True only while Android's first-run microphone permission prompt is pending. */
  public isRequestingMicPermission(): boolean {
    return this.permissionRequestInProgress;
  }

  public getLastStartOptions(): {
    locale: string;
    useOfflineRecognizer: boolean;
    preferOffline: boolean;
  } | null {
    return this.lastStartOptions;
  }

  public async start(
    locale = 'en-US',
    options?: { useOfflineRecognizer?: boolean; preferOffline?: boolean }
  ): Promise<void> {
    if (this.active) return;
    this.startMs = Date.now();
    this.active = true;
    const useOfflineRecognizer = options?.useOfflineRecognizer ?? false;
    const preferOffline = options?.preferOffline ?? false;
    this.activeCaptureMode = useOfflineRecognizer ? 'offline_recognizer' : 'online_wav';
    this.lastStartOptions = { locale, useOfflineRecognizer, preferOffline };

    if (Capacitor.isNativePlatform()) {
      try {
        // Resolve permission separately so its native dialog is not mistaken for app backgrounding.
        this.permissionRequestInProgress = true;
        let permissionGranted = false;
        try {
          permissionGranted = await requestNativeMicPermission();
        } finally {
          this.permissionRequestInProgress = false;
        }
        if (!permissionGranted) {
          throw new Error('Microphone permission was not granted. Allow microphone access and try again.');
        }

        const result = await SpeakCoachSpeechNative.startRecording({
          locale,
          useOfflineRecognizer,
          preferOffline
        });
        if (!result?.started) {
          throw new Error('The Android speech recorder did not confirm that recording started.');
        }
      } catch (error) {
        this.permissionRequestInProgress = false;
        this.active = false;
        this.startMs = 0;
        this.lastStartOptions = null;
        throw error;
      }
      return;
    }

    this.webChunks = [];
    if (
      !useOfflineRecognizer &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    ) {
      try {
        this.webStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.webContext = new AudioCtx();
        this.webSampleRate = this.webContext.sampleRate || 16000;
        const source = this.webContext.createMediaStreamSource(this.webStream);
        this.webProcessor = this.webContext.createScriptProcessor(4096, 1, 1);
        this.webProcessor.onaudioprocess = (ev) => {
          if (!this.active) return;
          const chan = ev.inputBuffer.getChannelData(0);
          this.webChunks.push(new Float32Array(chan));
        };
        source.connect(this.webProcessor);
        this.webProcessor.connect(this.webContext.destination);
      } catch {
        // Ignore in headless environment
      }
    }
  }

  public async stop(): Promise<RecordedUtterance> {
    const rawElapsed = this.startMs > 0 ? Date.now() - this.startMs : 2800;
    const durationMs = Math.max(200, Math.min(130000, rawElapsed));
    const captureMode = this.activeCaptureMode;
    this.active = false;
    this.startMs = 0;

    if (Capacitor.isNativePlatform()) {
      const res = await SpeakCoachSpeechNative.stopRecording();
      const rawTranscript = (res.offlineTranscript ?? '').trim();
      const rawConf =
        typeof res.offlineConfidence === 'number' && res.offlineConfidence > 0
          ? res.offlineConfidence
          : 0;
      const alts = Array.isArray(res.offlineAlternatives)
        ? res.offlineAlternatives
        : rawTranscript
          ? [{ transcript: rawTranscript, confidence: rawConf }]
          : [];
      const wavB64 = captureMode === 'offline_recognizer' ? '' : (res.wavBase64 || '');
      return {
        wavBase64: wavB64,
        wavDataUrl: wavB64 ? `data:audio/wav;base64,${wavB64}` : '',
        durationMs: res.durationMs || durationMs,
        sampleRate: res.sampleRate || 16000,
        offlineTranscript: rawTranscript,
        offlineConfidence: rawConf,
        offlineAlternatives: alts,
        recognizerError: res.recognizerError || undefined
      };
    }

    if (this.webProcessor) {
      this.webProcessor.disconnect();
      this.webProcessor = null;
    }
    if (this.webContext) {
      try {
        await this.webContext.close();
      } catch {
        // Ignore close error
      }
      this.webContext = null;
    }
    if (this.webStream) {
      this.webStream.getTracks().forEach((t) => t.stop());
      this.webStream = null;
    }

    const totalSamples = this.webChunks.reduce((acc, c) => acc + c.length, 0);
    let wavBase64 = '';
    if (captureMode === 'online_wav' && totalSamples > 0) {
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of this.webChunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const wavBytes = encodeFloat32ToWav16kMonoBytes(merged, this.webSampleRate);
      wavBase64 = uint8ArrayToBase64(wavBytes);
    }

    const mock = this.mockRecognizerOutput;
    this.mockRecognizerOutput = null;
    const transcript = (mock?.transcript ?? '').trim();
    const confidence = mock?.confidence ?? 0;
    const alternatives =
      mock?.alternatives ?? (transcript ? [{ transcript, confidence }] : []);

    return {
      wavBase64,
      wavDataUrl: wavBase64 ? `data:audio/wav;base64,${wavBase64}` : '',
      durationMs,
      sampleRate: 16000,
      offlineTranscript: transcript,
      offlineConfidence: confidence,
      offlineAlternatives: alternatives,
      recognizerError: mock?.error
    };
  }
}

export const audioRecorder = new AudioRecorderService();
