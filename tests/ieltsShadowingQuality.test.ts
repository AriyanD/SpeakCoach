import { describe, expect, it } from 'vitest';
import type { ShadowingSentence } from '../src/data/shadowingBank';
import { makeMemoryEntry } from '../src/services/generationVariety';
import {
  buildIeltsShadowingPrompt, buildIeltsShadowingSlots, getIeltsShadowingSetStructure,
  validateIeltsShadowingCandidates, type IeltsShadowingCandidate
} from '../src/services/ieltsShadowingQuality';

describe('IELTS Shadowing answer generation', () => {
  it('creates exactly the 6/6/8 answer structure from six seed questions', () => {
    const slots = buildIeltsShadowingSlots();
    expect(slots).toHaveLength(20);
    expect(slots.filter(slot => slot.part === 1)).toHaveLength(6);
    expect(slots.filter(slot => slot.part === 2)).toHaveLength(6);
    expect(slots.filter(slot => slot.part === 3)).toHaveLength(8);
    expect(new Set(slots.map(slot => slot.q)).size).toBe(6);
    expect(getIeltsShadowingSetStructure()).toEqual({ part1: 6, part2: 6, part3: 8, total: 20 });
  });

  it('keeps the assigned-question prompt compact', () => {
    const prompt = buildIeltsShadowingPrompt(buildIeltsShadowingSlots('public transport'));
    expect(prompt.length / 4).toBeLessThanOrEqual(969);
    expect(prompt.length).toBeLessThan(3000);
    expect(prompt).toContain('not official questions or answers');
    expect(prompt).toContain('chunk');
  });

  it('uses a spare candidate before requesting repair when the first is a cliché', () => {
    const slot = buildIeltsShadowingSlots()[0];
    const candidates: IeltsShadowingCandidate[] = [
      { q: slot.q, fn: slot.fn, text: 'In this day and age, people often say that practical learning matters, although I have not always found that to be true in daily life.', chunk: 'practical learning' },
      { q: slot.q, fn: slot.fn, text: 'Earlier this year, I joined a neighbourhood repair session where volunteers showed me how to mend a loose bicycle chain safely.', chunk: 'neighbourhood repair session' }
    ];
    const result = validateIeltsShadowingCandidates(candidates, [slot], []);
    expect(result.rejected).toBe(1);
    expect(result.sentences).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
    expect(result.sentences[0].question).toBe(slot.question);
    expect(result.sentences[0].answerFunction).toBe(slot.fn);
    expect(result.sentences[0].part).toBe(slot.part);
  });

  it('rejects near-identical sentences from the previous two sets', () => {
    const slot = buildIeltsShadowingSlots()[0];
    const repeated = 'Earlier this year, I joined a neighbourhood repair session where volunteers showed me how to mend a loose bicycle chain safely.';
    const candidate: IeltsShadowingCandidate = { q: slot.q, fn: slot.fn, text: repeated, chunk: 'repair session' };
    const result = validateIeltsShadowingCandidates([candidate], [slot], [makeMemoryEntry(repeated, 'en')]);
    expect(result.sentences).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
  });


  it('uses 0.60 for recent IELTS Shadowing history and 0.70 for older history', () => {
    const slot = buildIeltsShadowingSlots()[0];
    const candidateText = 'Earlier this year, I joined a neighbourhood repair session where volunteers showed me how to mend a loose bicycle chain safely.';
    const nearMatch = 'Earlier this year, I joined a neighbourhood repair session where volunteers taught me how to mend a broken bicycle wheel safely.';
    const candidate: IeltsShadowingCandidate = { q: slot.q, fn: slot.fn, text: candidateText, chunk: 'bicycle chain' };
    const older = [makeMemoryEntry(nearMatch, 'en'), ...Array.from({ length: 40 }, (_, index) => makeMemoryEntry(`An unrelated older IELTS memory sentence number ${index}.`, 'en'))];
    const recent = [...Array.from({ length: 40 }, (_, index) => makeMemoryEntry(`An unrelated recent IELTS memory sentence number ${index}.`, 'en')), makeMemoryEntry(nearMatch, 'en')];
    expect(validateIeltsShadowingCandidates([candidate], [slot], older).sentences).toHaveLength(1);
    expect(validateIeltsShadowingCandidates([candidate], [slot], recent).sentences).toHaveLength(0);
  });

  it('loads legacy stored sentences and round-trips the new optional fields', () => {
    const oldSentence: ShadowingSentence = {
      id: 'old', difficulty: 'ielts', topic: 'Work', text: 'An older stored sentence remains valid.', phoneticFocus: 'linking', expectedTotalDurationMs: 5000
    };
    expect(JSON.parse(JSON.stringify(oldSentence))).toEqual(oldSentence);
    const current: ShadowingSentence = {
      ...oldSentence, part: 2, question: 'Describe a useful skill.', answerFunction: 'E',
      chunk: 'a useful skill', seedId: 'p2-skill'
    };
    expect(JSON.parse(JSON.stringify(current))).toEqual(current);
  });
});
