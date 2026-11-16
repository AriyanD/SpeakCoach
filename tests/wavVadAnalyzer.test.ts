import { describe, expect, it } from 'vitest';
import {
   encodeFloat32ToWav16kMonoBytes,
  uint8ArrayToBase64
} from '../src/services/audioRecorder';
import {
  analyzePcmSamplesVad,
  analyzeWavBase64Vad
} from '../src/services/wavVadAnalyzer';

describe('Offline WAV Energy-Based VAD & Waveform Analyzer', () => {
  it('accurately measures leading silence, trailing silence, speech duration, and mid-sentence pauses on synthetic audio', () => {
    const sampleRate = 16000;
    // Total 3.0 seconds (48000 samples):
    // 0.0s - 0.4s: leading silence (400 ms)
    // 0.4s - 1.2s: speech burst 1 (800 ms)
    // 1.2s - 1.6s: mid-sentence pause (400 ms)
    // 1.6s - 2.5s: speech burst 2 (900 ms)
    // 2.5s - 3.0s: trailing silence (500 ms)
    const samples = new Float32Array(sampleRate * 3);

    const fillTone = (startMs: number, endMs: number, amp: number) => {
      const sIdx = Math.floor((startMs / 1000) * sampleRate);
      const eIdx = Math.floor((endMs / 1000) * sampleRate);
      for (let i = sIdx; i < eIdx; i++) {
        samples[i] = amp * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
      }
    };

    fillTone(400, 1200, 0.5);
    fillTone(1600, 2500, 0.45);

    const result = analyzePcmSamplesVad(samples, {
      sampleRate,
      expectedDurationMs: 1700,
      minPauseMs: 200,
      waveformBinCount: 30
    });

    expect(result.isApproximate).toBe(true);
    expect(result.label.toLowerCase()).toContain('approximate');
    expect(result.totalDurationMs).toBe(3000);
    expect(result.leadingSilenceMs).toBe(400);
    expect(result.trailingSilenceMs).toBe(500);
    expect(result.speechDurationMs).toBe(1700); // 800 + 900 ms
    expect(result.speakingRateRatio).toBeCloseTo(1.0, 1);
    expect(result.speakingRateLabel).toBe('normal');

    expect(result.midSentencePauses).toHaveLength(1);
    expect(result.midSentencePauses[0].startMs).toBe(1200);
    expect(result.midSentencePauses[0].endMs).toBe(1600);
    expect(result.midSentencePauses[0].durationMs).toBe(400);

    const pauseBins = result.waveformBins.filter((b) => b.state === 'pause');
    expect(pauseBins.length).toBeGreaterThanOrEqual(1);
  });

  it('decodes base64 16 kHz mono WAV and handles pure silence gracefully', () => {
    const silentSamples = new Float32Array(16000); // 1.0s silence
    const wavBytes = encodeFloat32ToWav16kMonoBytes(silentSamples, 16000);
    const b64 = uint8ArrayToBase64(wavBytes);

    const res = analyzeWavBase64Vad(b64, 2000);
    expect(res.speechDurationMs).toBe(0);
    expect(res.speakingRateLabel).toBe('no-speech');
    expect(res.midSentencePauses).toHaveLength(0);
  });
});
