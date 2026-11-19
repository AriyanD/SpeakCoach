import { describe, expect, it } from 'vitest';
import { createEmptyShadowingSetHistory, makeSeedHistory } from '../src/services/shadowingSetHistory';
import { getSupportedMultilingualSentenceLanguages } from '../src/data/multilingualShadowingSentenceSets';
import { SHADOWING_LANGUAGES } from '../src/data/shadowingLanguages';
import {
  getShadowingHistoryForLanguage,
  setShadowingHistoryForLanguage,
  type ShadowingLanguageHistories
} from '../src/services/shadowingLanguageHistory';

describe('language-specific Shadowing history', () => {
  it('provides exactly one offline starter sentence at each difficulty for every non-English app language', () => {
    const nonEnglishCodes = SHADOWING_LANGUAGES.map(language => language.code).filter(code => code !== 'en');
    expect(getSupportedMultilingualSentenceLanguages().sort()).toEqual([...nonEnglishCodes].sort());

    for (const languageCode of nonEnglishCodes) {
      const history = makeSeedHistory(languageCode);
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const activeSet = history[difficulty].sets[0];
        expect(history[difficulty].sets).toHaveLength(1);
        expect(activeSet.source).toBe('builtin');
        expect(activeSet.sentences).toHaveLength(1);
        expect(activeSet.sentences[0].text.trim().length).toBeGreaterThan(0);
        expect(activeSet.sentences[0].difficulty).toBe(difficulty);
      }
    }
  });

  it('keeps the English seed bank separate and unchanged at twenty sentences per difficulty', () => {
    const english = makeSeedHistory('en');
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      expect(english[difficulty].sets[0].sentences).toHaveLength(20);
      expect(english[difficulty].sets[0].sentences.every(sentence => sentence.difficulty === difficulty)).toBe(true);
    }
  });
  it('creates an empty history without copying English starter sentences', () => {
    const empty = createEmptyShadowingSetHistory();
    expect(empty.easy.sets).toEqual([]);
    expect(empty.medium.sets).toEqual([]);
    expect(empty.hard.sets).toEqual([]);
    expect(empty.easy.activeSetId).toBe('');
  });

  it('keeps language histories isolated when switching languages', () => {
    const english = createEmptyShadowingSetHistory();
    const swedish = createEmptyShadowingSetHistory();
    const histories: ShadowingLanguageHistories = { en: english };
    const next = setShadowingHistoryForLanguage(histories, 'sv', swedish);
    expect(getShadowingHistoryForLanguage(next, 'en')).toBe(english);
    expect(getShadowingHistoryForLanguage(next, 'sv')).toBe(swedish);
    expect(histories.sv).toBeUndefined();
  });
});
