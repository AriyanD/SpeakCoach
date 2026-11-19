import { describe, expect, it } from 'vitest';
import {
  getElevenLabsLanguageCode,
  isAzurePronunciationLocaleSupported,
  normalizeSpeechLocale,
  toWhisperLanguageCode
} from '../src/services/shadowingSpeechLanguage';

describe('Shadowing speech language routing', () => {
  it('preserves supported BCP-47 locales instead of collapsing them to English', () => {
    expect(normalizeSpeechLocale('sv-SE')).toBe('sv-SE');
    expect(normalizeSpeechLocale('fa-IR')).toBe('fa-IR');
    expect(normalizeSpeechLocale('ja-JP')).toBe('ja-JP');
  });

  it('uses English only for an invalid or missing locale', () => {
    expect(normalizeSpeechLocale('')).toBe('en-US');
    expect(normalizeSpeechLocale('not-a-locale')).toBe('en-US');
  });

  it('maps Whisper locale values to ISO-639-1 language hints', () => {
    expect(toWhisperLanguageCode('sv-SE')).toBe('sv');
    expect(toWhisperLanguageCode('fa-IR')).toBe('fa');
    expect(toWhisperLanguageCode('zh-CN')).toBe('zh');
  });

  it('matches Azure pronunciation assessment documented locale coverage', () => {
    expect(isAzurePronunciationLocaleSupported('sv-SE')).toBe(true);
    expect(isAzurePronunciationLocaleSupported('fa-IR')).toBe(false);
    expect(isAzurePronunciationLocaleSupported('tr-TR')).toBe(false);
  });

  it('does not route unsupported languages to ElevenLabs multilingual voices', () => {
    expect(getElevenLabsLanguageCode('sv-SE')).toBe('sv');
    expect(getElevenLabsLanguageCode('fa-IR')).toBeNull();
    expect(getElevenLabsLanguageCode('ja-JP')).toBe('ja');
  });
});
