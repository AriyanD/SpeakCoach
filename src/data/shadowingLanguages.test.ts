import { describe, expect, it } from 'vitest';
import {
  countShadowingLanguageUnits,
  DEFAULT_SHADOWING_LANGUAGE,
  getShadowingLanguage,
  SHADOWING_LANGUAGES
} from './shadowingLanguages';

describe('Shadowing language registry', () => {
  it('provides a valid default English language', () => {
    expect(getShadowingLanguage(DEFAULT_SHADOWING_LANGUAGE).locale).toBe('en-US');
  });

  it('falls back safely for an unknown language code', () => {
    expect(getShadowingLanguage('xx').code).toBe(DEFAULT_SHADOWING_LANGUAGE);
  });

  it('keeps language codes unique and locales populated', () => {
    const codes = SHADOWING_LANGUAGES.map(language => language.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(SHADOWING_LANGUAGES.every(language => language.locale && language.nativeName)).toBe(true);
  });

  it('counts whitespace-separated words for languages that use spaces', () => {
    expect(countShadowingLanguageUnits('Good morning, how are you?', 'en')).toBe(5);
    expect(countShadowingLanguageUnits('سلام، حال شما چطور است؟', 'fa')).toBe(5);
  });

  it('does not treat an unspaced CJK sentence as one word', () => {
    expect(countShadowingLanguageUnits('今日はいい天気ですね', 'ja')).toBeGreaterThan(1);
    expect(countShadowingLanguageUnits('今天天气很好', 'zh')).toBeGreaterThan(1);
  });

  it('returns zero units for empty input', () => {
    expect(countShadowingLanguageUnits('   ', 'en')).toBe(0);
  });
});
