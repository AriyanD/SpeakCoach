/**
 * Decodes a base64 string to Uint8Array in both browser and Node/Vitest environments.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  const trimmed = clean.trim().replace(/\s/g, '');

  if (typeof atob === 'function') {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js fallback
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(trimmed, 'base64'));
  }

  return new Uint8Array(0);
}

/**
 * Encodes Uint8Array bytes to standard base64 string in both browser and Node.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  return '';
}

/**
 * Wraps raw Linear PCM 16-bit signed LE mono bytes into a valid RIFF/WAVE container.
 * Default sample rate for Gemini 3.8 / TTS outputs is 24000 Hz.
 */
export function wrapPcm16LeToWavBytes(
  pcmBytes: Uint8Array,
  sampleRate = 24000,
  numChannels = 1
): Uint8Array {
  const pcmByteLen = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + pcmByteLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, pcmByteLen, true);

  // Copy PCM data
  new Uint8Array(buffer, 44).set(pcmBytes);

  return new Uint8Array(buffer);
}

/**
 * Converts raw base64 PCM (or existing WAV base64) into a playable `data:audio/wav;base64,...` data URL.
 */
export function convertPcmBase64ToWavDataUrl(
  base64Audio: string,
  sampleRate = 24000
): string {
  const cleanB64 = base64Audio.includes(',') ? base64Audio.split(',')[1] : base64Audio;
  const rawBytes = base64ToUint8Array(cleanB64);

  // If already contains a valid RIFF header, return as WAV data URL directly
  if (
    rawBytes.length >= 12 &&
    rawBytes[0] === 0x52 && // 'R'
    rawBytes[1] === 0x49 && // 'I'
    rawBytes[2] === 0x46 && // 'F'
    rawBytes[3] === 0x46 // 'F'
  ) {
    return `data:audio/wav;base64,${cleanB64}`;
  }

  const wavBytes = wrapPcm16LeToWavBytes(rawBytes, sampleRate);
  const wavBase64 = uint8ArrayToBase64(wavBytes);
  return `data:audio/wav;base64,${wavBase64}`;
}
