import { describe, expect, it } from 'vitest';
import { createEmptyShadowingSetHistory } from '../src/services/shadowingSetHistory';
import {
  getShadowingHistoryForLanguage,
  setShadowingHistoryForLanguage,
  type ShadowingLanguageHistories
} from '../src/services/shadowingLanguageHistory';

describe('language-specific Shadowing history', () => {
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
