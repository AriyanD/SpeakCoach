import { describe, expect, it } from 'vitest';
import { countShadowingLanguageUnits } from '../src/data/shadowingLanguages';
import { clampShadowingSentenceBatchCount, mapShadowingResponseRows, normalizeShadowingSentenceForDuplicateCheck, parseShadowingSentenceResponse } from '../src/services/shadowingAiGenerator';

describe('AI Shadowing sentence response parsing', () => {
  it('counts whitespace-separated words correctly and accepts nested sentence fields', () => {
    const parsed = parseShadowingSentenceResponse(JSON.stringify({
      topic: 'Daily routines',
      sentence: { text: 'I usually prepare a simple breakfast before I leave home for work each morning.' },
      phoneticFocus: 'Sentence stress'
    }), 'easy');
    expect(parsed.text.split(/\s+/)).toHaveLength(14);
    expect(parsed.topic).toBe('Daily routines');
  });


  it('maps out-of-order indexed responses to their original rows', () => {
    expect(mapShadowingResponseRows([{ n: 2 }, { n: 1 }], [1, 2])).toEqual([1, 0]);
  });

  it('falls back to array position when the row index is missing or invalid', () => {
    expect(mapShadowingResponseRows([{}, { n: 99 }, { n: 3 }], [1, 2, 3])).toEqual([0, 1, 2]);
  });

  it('rejects duplicate row indexes while keeping the first valid item', () => {
    expect(mapShadowingResponseRows([{ n: 1 }, { n: 1 }, { n: 2 }], [1, 2, 3])).toEqual([0, null, 1]);
  });

  it('allows a 20-sentence batch and clamps unsafe batch sizes', () => {
    expect(clampShadowingSentenceBatchCount(20)).toBe(20);
    expect(clampShadowingSentenceBatchCount(100)).toBe(20);
    expect(clampShadowingSentenceBatchCount(1)).toBe(2);
  });

  it('normalizes Unicode text and punctuation without collapsing different sentences', () => {
    expect(normalizeShadowingSentenceForDuplicateCheck('Hello, WORLD!')).toBe('hello world');
    expect(normalizeShadowingSentenceForDuplicateCheck('Hello world')).toBe('hello world');
    expect(normalizeShadowingSentenceForDuplicateCheck('The city is quiet.')).not.toBe(normalizeShadowingSentenceForDuplicateCheck('The city is crowded.'));
  });


  it('applies the distinct per-level length bands with a two-unit tolerance', () => {
    const cases = [
      { level: 'easy' as const, valid: 18, invalid: 19 },
      { level: 'medium' as const, valid: 24, invalid: 25 },
      { level: 'hard' as const, valid: 30, invalid: 31 },
      { level: 'ielts' as const, valid: 32, invalid: 33 }
    ];
    for (const item of cases) {
      const validText = Array.from({ length: item.valid }, (_, index) => `word${index}`).join(' ');
      const invalidText = Array.from({ length: item.invalid }, (_, index) => `word${index}`).join(' ');
      expect(parseShadowingSentenceResponse(JSON.stringify({ text: validText }), item.level).text).toBe(validText);
      expect(() => parseShadowingSentenceResponse(JSON.stringify({ text: invalidText }), item.level)).toThrow('length:');
    }
  });

  it('counts realistic English, Swedish, Chinese and Japanese sentences using language units', () => {
    const samples = [
      { language: 'en' as const, text: 'I usually prepare a simple breakfast before I leave home for work each morning.' },
      { language: 'sv' as const, text: 'Jag brukar ta en kort promenad efter arbetet eftersom det hjälper mig att koppla av och tänka klart.' },
      { language: 'zh' as const, text: '今天我下班后去公园散步，因为那里很安静。' },
      { language: 'ja' as const, text: '仕事のあと公園を散歩すると気分が落ち着きます。' }
    ];
    for (const sample of samples) {
      const units = countShadowingLanguageUnits(sample.text, sample.language);
      expect(units).toBeGreaterThanOrEqual(6);
      expect(units).toBeLessThanOrEqual(18);
      expect(parseShadowingSentenceResponse(JSON.stringify({ text: sample.text }), 'easy', sample.language).text).toBe(sample.text);
    }
  });

  it('accepts IELTS answer sentences in the extended 18–30 word range', () => {
    const text = 'To be honest, I really enjoy living near the coast because it gives me room to unwind, and I can still reach work easily.';
    expect(parseShadowingSentenceResponse(JSON.stringify({ text }), 'ielts').text).toBe(text);
  });

  it('rejects responses outside the required 8–28 word range with a useful count', () => {
    expect(() => parseShadowingSentenceResponse(JSON.stringify({
      text: 'I enjoy reading books.'
    }), 'easy')).toThrow('contained 4 words');
  });
});
