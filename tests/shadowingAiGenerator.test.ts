import { describe, expect, it } from 'vitest';
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
