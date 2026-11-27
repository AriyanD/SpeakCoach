import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IELTS_FREQUENT_QUESTIONS } from '../src/data/ieltsFrequentQuestions';
import { CUE_CARD_SEEDS, IELTS_PART1_FORMS, IELTS_PART3_FORMS, getIeltsQualityMemorySnapshot, restoreIeltsQualityMemorySnapshot, takePersistedIeltsDeck, takeWeightedQuestionSeeds, weightedOrder } from '../src/services/ieltsGenerationQuality';
import { buildGeneratorPrompt, createIeltsGenerationContext, getRecentQuestionOverlapTier, hasRecentQuestionOverlap } from '../src/services/ieltsQuestionGenerator';

describe('IELTS question generation quality', () => {
  beforeEach(() => localStorage.clear());

  it('catches short cue-card title overlaps using lemmatised tokens', () => {
    expect(hasRecentQuestionOverlap('A useful skill', ['Useful skills'], true)).toBe(true);
    expect(hasRecentQuestionOverlap('A place to relax', ['Places for relaxing'], true)).toBe(true);
    expect(hasRecentQuestionOverlap('A useful skill', ['A crowded market'], true)).toBe(false);
  });


  it('uses the full stored IELTS question window even after several sets were accepted', () => {
    const stored = Array.from({ length: 80 }, (_, index) => `Stored IELTS question number ${index + 1} about a distinct subject`);
    const acceptedBatch = Array.from({ length: 48 }, (_, index) => `Accepted batch question number ${index + 1} about another subject`);
    const memory = [...stored, ...acceptedBatch];
    const repeated = stored[0];
    expect(getRecentQuestionOverlapTier(repeated, memory)).toBe('exact');
    expect(hasRecentQuestionOverlap(repeated, memory)).toBe(true);
  });

  it('softens older near-overlaps while retaining the recent-question threshold', () => {
    const question = 'How can public libraries support lifelong learning in modern communities?';
    const nearMatch = 'How can public libraries support lifelong education in modern communities?';
    const similarityBand = [nearMatch];
    expect(getRecentQuestionOverlapTier(question, similarityBand)).toBe('recent');
    const olderMemory = [nearMatch, ...Array.from({ length: 24 }, (_, index) => `Unrelated recent question ${index}`)];
    expect(getRecentQuestionOverlapTier(question, olderMemory)).toBe('older');
    expect(hasRecentQuestionOverlap(question, olderMemory)).toBe(false);
  });


  it('uses informative IELTS avoid keywords instead of question words and auxiliaries', () => {
    const context = createIeltsGenerationContext([], '');
    const prompt = buildGeneratorPrompt([], [
      'Where do you usually go when you want to relax after work?',
      'How often do you think about the environment when you shop?',
      'What kind of books do you enjoy reading in your free time?',
      'Would you like to travel more often in the future?'
    ], '', context, [
      'A place where you can relax',
      'A book you enjoyed reading'
    ]);
    const avoidLine = prompt.system.split('\n').find(line => line.startsWith('Recent questions and cue-card titles'));
    expect(avoidLine).toBeTruthy();
    expect(avoidLine).toContain('environment');
    expect(avoidLine).not.toMatch(/\b(what|when|where|which|does|have|think|like|enjoy|often|usually|much|many|more|most|some|other|people|would|could|should|about|their|there|you|your)\b/i);
  });

  it('persists shuffled decks and does not repeat before exhaustion', () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f'];
    const first = takePersistedIeltsDeck('test-persistence', values, 2);
    const second = takePersistedIeltsDeck('test-persistence', values, 2);
    expect(new Set([...first, ...second]).size).toBe(4);
    const stored = localStorage.getItem('speakcoach_ielts_quality_v1.test-persistence');
    expect(stored).toBeTruthy();
  });

  it('persists weighted question decks and avoids repeats before the cycle is exhausted', () => {
    const first = takeWeightedQuestionSeeds(2, 1);
    const second = takeWeightedQuestionSeeds(2, 1);
    expect(first[0].id).not.toBe(second[0].id);
    const snapshot = getIeltsQualityMemorySnapshot();
    localStorage.clear();
    restoreIeltsQualityMemorySnapshot(snapshot);
    expect(localStorage.getItem('speakcoach_ielts_quality_v1.questions-p2')).toBeTruthy();
  });


  it('scores each weighted seed once and deterministically favours older or higher-frequency items', () => {
    const items = [
      { id: 'recent', freq: 1 },
      { id: 'older', freq: 1 },
      { id: 'frequent', freq: 2 }
    ];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const first = weightedOrder(items, { recent: 9, older: 0, frequent: 9 }, 10);
      expect(random).toHaveBeenCalledTimes(items.length);
      expect(first.map(item => item.id)).toEqual(['frequent', 'older', 'recent']);
      random.mockClear();
      const second = weightedOrder(items, { recent: 9, older: 0, frequent: 9 }, 10);
      expect(second.map(item => item.id)).toEqual(first.map(item => item.id));
      expect(random).toHaveBeenCalledTimes(items.length);
    } finally {
      random.mockRestore();
    }
  });

  it('lets an explicitly requested theme override the random cue-card type and subject', () => {
    const context = createIeltsGenerationContext([], 'Community repair cafés');
    expect(context.cueCardType).toBe('user-selected theme');
    expect(context.cueCardSubject).toBe('Community repair cafés');
  });

  it('provides at least fifteen concrete subjects for every cue-card type', () => {
    expect(Object.keys(CUE_CARD_SEEDS)).toHaveLength(9);
    for (const subjects of Object.values(CUE_CARD_SEEDS)) expect(subjects.length).toBeGreaterThanOrEqual(15);
  });

  it('contains the requested question coverage and answer-form decks', () => {
    expect(IELTS_FREQUENT_QUESTIONS.filter(item => item.part === 1).length).toBeGreaterThanOrEqual(90);
    expect(IELTS_FREQUENT_QUESTIONS.filter(item => item.part === 2)).toHaveLength(20);
    expect(IELTS_FREQUENT_QUESTIONS.filter(item => item.part === 3).length).toBeGreaterThanOrEqual(40);
    expect(IELTS_PART1_FORMS).toHaveLength(7);
    expect(IELTS_PART3_FORMS).toHaveLength(9);
  });

  it('keeps the compact question-generation prompt below the old prompt budget', () => {
    const context = createIeltsGenerationContext([], '');
    const prompt = buildGeneratorPrompt([], [], '', context, []);
    expect(prompt.system.length / 4).toBeLessThanOrEqual(969);
    expect(prompt.system.length).toBeLessThan(2200);
    expect(prompt.system).toContain('Do not claim this is official');
    expect(prompt.system).toContain(context.cueCardSubject);
    expect(prompt.system).toContain((context.part1Forms ?? []).join(', '));
    expect(prompt.system).toContain((context.part3Forms ?? []).join(', '));
  });

  it('rotates three compact system-prompt variants without adding history text', () => {
    const context = createIeltsGenerationContext([], '');
    const first = buildGeneratorPrompt([], [], '', context).system;
    const second = buildGeneratorPrompt([], [], '', context).system;
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThan(3874);
    expect(second.length).toBeLessThan(3874);
  });
});
