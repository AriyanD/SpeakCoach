export interface MidSentencePause {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface WaveformBin {
  index: number;
  startMs: number;
  endMs: number;
  amplitude: number; // 0..1 normalized
  state: 'speech' | 'pause' | 'silence';
}

export interface WavVadAnalysisResult {
  isApproximate: true;
  label: string;
  totalDurationMs: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  speechDurationMs: number;
  expectedDurationMs: number;
  speakingRateRatio: number; // speechDurationMs / expectedDurationMs
  speakingRateLabel: 'normal' | 'fast' | 'slow' | 'no-speech';
  midSentencePauses: MidSentencePause[];
  totalPauseDurationMs: number;
  waveformBins: WaveformBin[];
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',')[1] ?? '' : base64;
  if (!clean || typeof atob !== 'function') return new Uint8Array(0);
  try {
    const bin = atob(clean.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

export function decodeWav16kMonoToFloat32(wavBytes: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (wavBytes.byteLength < 44) {
    return { samples: new Float32Array(0), sampleRate: 16000 };
  }
  const view = new DataView(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength);
  const sampleRate = view.getUint32(24, true) || 16000;
  const pcmBytes = wavBytes.byteLength - 44;
  const sampleCount = Math.floor(pcmBytes / 2);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(44 + i * 2, true);
    samples[i] = int16 / 32768;
  }

  return { samples, sampleRate };
}

export function analyzePcmSamplesVad(
  samples: Float32Array,
  options?: {
    sampleRate?: number;
    expectedDurationMs?: number;
    minPauseMs?: number;
    waveformBinCount?: number;
  }
): WavVadAnalysisResult {
  const sampleRate = options?.sampleRate ?? 16000;
  const expectedDurationMs = Math.max(400, options?.expectedDurationMs ?? 3500);
  const minPauseMs = options?.minPauseMs ?? 200;
  const binCount = options?.waveformBinCount ?? 36;

  const frameMs = 20;
  const samplesPerFrame = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const totalFrames = Math.floor(samples.length / samplesPerFrame);
  const totalDurationMs = totalFrames * frameMs;

  if (totalFrames === 0) {
    return {
      isApproximate: true,
      label: 'Approximate offline WAV energy analysis (VAD)',
      totalDurationMs: 0,
      leadingSilenceMs: 0,
      trailingSilenceMs: 0,
      speechDurationMs: 0,
      expectedDurationMs,
      speakingRateRatio: 0,
      speakingRateLabel: 'no-speech',
      midSentencePauses: [],
      totalPauseDurationMs: 0,
      waveformBins: []
    };
  }

  const frameRms = new Float32Array(totalFrames);
  let peakRms = 0;

  for (let f = 0; f < totalFrames; f++) {
    let sumSq = 0;
    const base = f * samplesPerFrame;
    for (let i = 0; i < samplesPerFrame; i++) {
      const s = samples[base + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / samplesPerFrame);
    frameRms[f] = rms;
    if (rms > peakRms) peakRms = rms;
  }

  const threshold = Math.max(0.015, peakRms * 0.14);
  const activeFrames = new Array<boolean>(totalFrames);
  let firstActive = -1;
  let lastActive = -1;
  let activeCount = 0;

  for (let f = 0; f < totalFrames; f++) {
    const isVoice = peakRms >= 0.018 && frameRms[f] >= threshold;
    activeFrames[f] = isVoice;
    if (isVoice) {
      if (firstActive === -1) firstActive = f;
      lastActive = f;
      activeCount++;
    }
  }

  if (firstActive === -1 || lastActive === -1) {
    const emptyBins: WaveformBin[] = Array.from({ length: Math.min(binCount, totalFrames) }, (_, b) => ({
      index: b,
      startMs: Math.round((b * totalDurationMs) / binCount),
      endMs: Math.round(((b + 1) * totalDurationMs) / binCount),
      amplitude: 0.04,
      state: 'silence'
    }));
    return {
      isApproximate: true,
      label: 'Approximate offline WAV energy analysis (VAD)',
      totalDurationMs,
      leadingSilenceMs: totalDurationMs,
      trailingSilenceMs: 0,
      speechDurationMs: 0,
      expectedDurationMs,
      speakingRateRatio: 0,
      speakingRateLabel: 'no-speech',
      midSentencePauses: [],
      totalPauseDurationMs: 0,
      waveformBins: emptyBins
    };
  }

  const leadingSilenceMs = firstActive * frameMs;
  const trailingSilenceMs = (totalFrames - 1 - lastActive) * frameMs;
  const speechDurationMs = activeCount * frameMs;

  const midSentencePauses: MidSentencePause[] = [];
  let silenceRunStart = -1;

  for (let f = firstActive + 1; f <= lastActive; f++) {
    if (!activeFrames[f]) {
      if (silenceRunStart === -1) silenceRunStart = f;
    } else if (silenceRunStart !== -1) {
      const pauseDur = (f - silenceRunStart) * frameMs;
      if (pauseDur >= minPauseMs) {
        midSentencePauses.push({
          startMs: silenceRunStart * frameMs,
          endMs: f * frameMs,
          durationMs: pauseDur
        });
      }
      silenceRunStart = -1;
    }
  }

  const totalPauseDurationMs = midSentencePauses.reduce((acc, p) => acc + p.durationMs, 0);
  const speakingRateRatio = Number((speechDurationMs / expectedDurationMs).toFixed(2));

  let speakingRateLabel: 'normal' | 'fast' | 'slow' | 'no-speech' = 'normal';
  if (speakingRateRatio < 0.75) {
    speakingRateLabel = 'fast';
  } else if (speakingRateRatio > 1.28) {
    speakingRateLabel = 'slow';
  }

  const actualBins = Math.min(binCount, totalFrames);
  const waveformBins: WaveformBin[] = [];
  const normPeak = Math.max(0.02, peakRms);

  for (let b = 0; b < actualBins; b++) {
    const startFrame = Math.floor((b * totalFrames) / actualBins);
    const endFrame = Math.max(startFrame + 1, Math.floor(((b + 1) * totalFrames) / actualBins));
    let maxBinRms = 0;
    for (let f = startFrame; f < endFrame && f < totalFrames; f++) {
      if (frameRms[f] > maxBinRms) maxBinRms = frameRms[f];
    }

    const startMs = startFrame * frameMs;
    const endMs = endFrame * frameMs;
    const midMs = (startMs + endMs) / 2;

    const inPause = midSentencePauses.some((p) => midMs >= p.startMs && midMs <= p.endMs);
    const inSpeechSpan =
      startFrame >= firstActive && endFrame - 1 <= lastActive && maxBinRms >= threshold;

    const state: 'speech' | 'pause' | 'silence' = inPause
      ? 'pause'
      : inSpeechSpan
        ? 'speech'
        : 'silence';

    waveformBins.push({
      index: b,
      startMs,
      endMs,
      amplitude: Number(Math.min(1, Math.max(0.06, maxBinRms / normPeak)).toFixed(2)),
      state
    });
  }

  return {
    isApproximate: true,
    label: 'Approximate offline WAV energy analysis (VAD)',
    totalDurationMs,
    leadingSilenceMs,
    trailingSilenceMs,
    speechDurationMs,
    expectedDurationMs,
    speakingRateRatio,
    speakingRateLabel,
    midSentencePauses,
    totalPauseDurationMs,
    waveformBins
  };
}

export function analyzeWavBase64Vad(
  wavBase64OrDataUrl: string,
  expectedDurationMs = 3500
): WavVadAnalysisResult {
  const bytes = base64ToUint8Array(wavBase64OrDataUrl);
  const { samples, sampleRate } = decodeWav16kMonoToFloat32(bytes);
  return analyzePcmSamplesVad(samples, { sampleRate, expectedDurationMs });
}


/**
 * Detect only near-digital-silence in standard PCM16 WAV recordings.
 * Unknown WAV encodings are treated as non-silent to avoid false rejection.
 */
export function isWavEffectivelySilent(base64: string, peakThreshold = 0.001): boolean {
  const bytes = base64ToUint8Array(base64);
  if (bytes.byteLength < 44) return false;
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(36) !== 'data') return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = view.getUint16(20, true);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = Math.min(view.getUint32(40, true), bytes.byteLength - 44);
  if (format !== 1 || channels < 1 || bitsPerSample !== 16 || dataBytes < 2) return false;

  const sampleCount = Math.floor(dataBytes / 2);
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const amplitude = Math.abs(view.getInt16(44 + i * 2, true) / 32768);
    if (amplitude > peak) {
      peak = amplitude;
      if (peak > peakThreshold) return false;
    }
  }
  return true;
}
