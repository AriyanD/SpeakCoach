import { describe, expect, it } from 'vitest';
import { generateProbeWavBase64 } from '../src/services/connectionTester';

function decodeWav(dataUri: string): DataView {
  const binary = atob(dataUri.replace(/^data:audio\/wav;base64,/, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new DataView(bytes.buffer);
}

describe('generateProbeWavBase64', () => {
  it('creates a valid 1-second, 16 kHz, mono PCM WAV payload', () => {
    const wav = decodeWav(generateProbeWavBase64());

    expect(String.fromCharCode(...Array.from({ length: 4 }, (_, i) => wav.getUint8(i)))).toBe('RIFF');
    expect(String.fromCharCode(...Array.from({ length: 4 }, (_, i) => wav.getUint8(8 + i)))).toBe('WAVE');
    expect(String.fromCharCode(...Array.from({ length: 4 }, (_, i) => wav.getUint8(12 + i)))).toBe('fmt ');
    expect(wav.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(wav.getUint32(16, true)).toBe(16);
    expect(wav.getUint16(20, true)).toBe(1); // PCM
    expect(wav.getUint16(22, true)).toBe(1); // mono
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint32(28, true)).toBe(32000);
    expect(wav.getUint16(32, true)).toBe(2);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(String.fromCharCode(...Array.from({ length: 4 }, (_, i) => wav.getUint8(36 + i)))).toBe('data');
    expect(wav.getUint32(40, true)).toBe(32000);
    expect(wav.byteLength).toBe(44 + 32000);
    expect(wav.getInt16(46, true)).not.toBe(0); // The generated audio is not silent.
  });

  it('keeps the WAV header and data length consistent for custom durations', () => {
    const wav = decodeWav(generateProbeWavBase64(0.25, 880));

    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint32(40, true)).toBe(8000);
    expect(wav.getUint32(4, true)).toBe(8036);
    expect(wav.byteLength).toBe(8044);
  });
});
