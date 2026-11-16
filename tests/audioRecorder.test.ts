import { beforeEach, describe, expect, it } from 'vitest';
import { audioRecorder, encodeFloat32ToWav16kMonoBytes } from '../src/services/audioRecorder';
import { IeltsSessionController } from '../src/services/ieltsSessionEngine';
import { saveSlotConfig, saveSlotConnectionTestResult } from '../src/storage/localStore';
import { saveApiKey } from '../src/storage/keyStore';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { networkMonitor } from '../src/services/networkMonitor';

describe('16 kHz Mono PCM WAV Recorder & Mode-Based Capture (A2-3)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
    audioRecorder.setMockRecognizerOutputForTest(null);
  });

  it('encodes Float32 audio into a valid 44-byte RIFF WAVE 16 kHz 16-bit mono PCM buffer', () => {
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const wavBytes = encodeFloat32ToWav16kMonoBytes(input, 48000);
    expect(wavBytes.byteLength).toBe(44 + 1600 * 2);

    const view = new DataView(wavBytes.buffer);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('returns an EMPTY transcript and never synthesizes fake sine-wave audio when no real audio was captured', async () => {
    await audioRecorder.start('en-US', { useOfflineRecognizer: true });
    expect(audioRecorder.isRecording()).toBe(true);

    const silentUtterance = await audioRecorder.stop();
    expect(audioRecorder.isRecording()).toBe(false);
    expect(silentUtterance.sampleRate).toBe(16000);
    // In offline recognizer mode (or when no mic stream exists), no fake WAV is synthesized!
    expect(silentUtterance.wavBase64).toBe('');
    expect(silentUtterance.wavDataUrl).toBe('');
    expect(silentUtterance.offlineTranscript).toBe('');
    expect(silentUtterance.offlineAlternatives).toEqual([]);
  });

  it('selects Mode A (useOfflineRecognizer: false, AudioRecord WAV only) when STT slot is online, and Mode B (useOfflineRecognizer: true, SpeechRecognizer only) when offline', async () => {
    // 1. Offline by default (no API key for ielts_stt) -> Mode B (useOfflineRecognizer: true)
    const ctrlOffline = new IeltsSessionController({ mode: 'part1' });
    await ctrlOffline.startCandidateRecording();
    expect(audioRecorder.getLastStartOptions()?.useOfflineRecognizer).toBe(true);
    expect(audioRecorder.getLastStartOptions()?.preferOffline).toBe(true);
    await audioRecorder.stop();
    ctrlOffline.clearAllTimers();

    // 2. Online Whisper STT configured with key -> Mode A (useOfflineRecognizer: false)
    await saveSlotConfig({
      slotId: 'ielts_stt',
      providerId: 'whisper_stt',
      baseUrl: 'https://api.groq.com/openai/v1',
      modelOrVoice: 'whisper-large-v3-turbo'
    });
    await saveApiKey('ielts_stt', 'whisper_stt', 'gsk-live-key');
    await saveSlotConnectionTestResult('ielts_stt', {
      ok: true, slotId: 'ielts_stt', providerId: 'whisper_stt', tier: 2,
      label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
    });

    const ctrlOnline = new IeltsSessionController({ mode: 'part1' });
    await ctrlOnline.startCandidateRecording();
    expect(audioRecorder.getLastStartOptions()?.useOfflineRecognizer).toBe(false);
    expect(audioRecorder.getLastStartOptions()?.preferOffline).toBe(false);
    await audioRecorder.stop();
    ctrlOnline.clearAllTimers();
  });
});
