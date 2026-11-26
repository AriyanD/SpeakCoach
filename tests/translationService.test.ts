import { describe, expect, it } from 'vitest';
import {
  buildGrammarFollowUpPrompt,
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

  it('builds grammar explanations in the explicitly selected language', () => {
    expect(buildShadowingTranslationPrompt('I have been working here.', 'Persian', 'grammar')).toContain('entirely in Persian');
    expect(buildShadowingTranslationPrompt('I have been working here.', 'English', 'grammar')).toContain('entirely in English');
  });

  it('builds a JSON-only prompt for sentence translation batches', () => {
    expect(buildShadowingTranslationPrompt('[\\"hello\\"]', 'Persian', 'batch')).toContain('valid JSON array of strings');
  });

  it('keeps only the latest six turns in a grammar follow-up prompt and includes sentence context', () => {
    const history = Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `turn-${index}` }));
    const prompt = JSON.parse(buildGrammarFollowUpPrompt({ sentence: 'I have been working here.', practiceLanguage: 'English', explanationLanguage: 'Persian', explanation: 'Present perfect continuous.', history, question: 'Why this tense?' }));
    expect(prompt.recentConversation).toHaveLength(6);
    expect(prompt.recentConversation[0].content).toBe('turn-2');
    expect(prompt.sentence).toContain('working here');
    expect(prompt.question).toBe('Why this tense?');
  });

  it('rejects text beyond the safe request size', () => {
    expect(() => buildShadowingTranslationPrompt('x'.repeat(4001), 'Persian')).toThrow('4,000 characters');
  });
});
