import { describe, expect, it } from 'vitest';
import {
  buildShadowingTranslationPrompt,
  extractShadowingTranslationText
} from '../src/services/translationService';

describe('Shadowing translation helpers', () => {
  it('builds a language-specific prompt for both sentences and single words', () => {
    expect(buildShadowingTranslationPrompt('good morning', 'Persian')).toContain('Translate the following text into Persian.');
    expect(buildShadowingTranslationPrompt('resilient', 'Swedish')).toContain('resilient');
    expect(() => buildShadowingTranslationPrompt('   ', 'Persian')).toThrow('Enter a word or sentence');
  });

  it('extracts Gemini and OpenAI-compatible plain-text responses', () => {
    expect(extractShadowingTranslationText({ candidates: [{ content: { parts: [{ text: 'سلام' }] } }] }, 'gemini')).toBe('سلام');
    expect(extractShadowingTranslationText({ choices: [{ message: { content: 'Bonjour' } }] }, 'openai')).toBe('Bonjour');
    expect(extractShadowingTranslationText({ choices: [{ message: { content: [{ text: 'Guten' }, { text: 'Tag' }] } }] }, 'openai')).toBe('Guten\nTag');
  });

  it('rejects text beyond the safe request size', () => {
    expect(() => buildShadowingTranslationPrompt('x'.repeat(4001), 'Persian')).toThrow('4,000 characters');
  });
});
