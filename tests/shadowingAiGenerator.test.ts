import { describe, expect, it } from 'vitest';
import { clampShadowingSentenceBatchCount, normalizeShadowingSentenceForDuplicateCheck, parseShadowingSentenceResponse } from '../src/services/shadowingAiGenerator';

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

  it('rejects responses outside the required 8–28 word range with a useful count', () => {
    expect(() => parseShadowingSentenceResponse(JSON.stringify({
      text: 'I enjoy reading books.'
    }), 'easy')).toThrow('contained 4 words');
  });
});
