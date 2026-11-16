import { beforeEach, describe, expect, it } from 'vitest';
import {
  generateIeltsSessionPlan,
  getPart1Topics,
  PART_1_QUESTIONS,
  PART_2_CUE_CARDS,
  PART_3_QUESTIONS
} from './fixtures/legacyIeltsQuestionBank';
import {
  clearSeenQuestions,
  getSeenQuestions,
  SEEN_QUESTIONS_STORAGE_KEY
} from '../src/services/ieltsQuestionTracker';
import { getReplacementUnseenQuestion } from './fixtures/legacyIeltsQuestionTracker';

describe('IELTS Question Bank (Stage 3.1 Offline Asset Pack)', () => {
  beforeEach(() => {
    clearSeenQuestions();
  });
  it('contains at least 50 Part 1 questions across 10 distinct topics', () => {
    expect(PART_1_QUESTIONS.length).toBeGreaterThanOrEqual(50);
    const topics = getPart1Topics();
    expect(topics.length).toBeGreaterThanOrEqual(10);
    for (const t of topics) {
      const count = PART_1_QUESTIONS.filter((q) => q.topic === t).length;
      expect(count).toBeGreaterThanOrEqual(4);
    }
  });

  it('contains at least 15 Part 2 cue cards with 4 prompt bullets each', () => {
    expect(PART_2_CUE_CARDS.length).toBeGreaterThanOrEqual(15);
    for (const cc of PART_2_CUE_CARDS) {
      expect(cc.title).toBeTruthy();
      expect(cc.prompt).toContain('You should say:');
      expect(cc.bullets).toHaveLength(4);
    }
  });

  it('contains at least 40 Part 3 questions linked to Part 2 cue card themes', () => {
    expect(PART_3_QUESTIONS.length).toBeGreaterThanOrEqual(40);
    const linkedCueCardIds = new Set(PART_3_QUESTIONS.map((q) => q.cueCardId));
    expect(linkedCueCardIds.size).toBeGreaterThanOrEqual(12);
  });

  it('generates a realistic IELTS session plan with 2 Part 1 topics, cue card, and linked Part 3', () => {
    const plan = generateIeltsSessionPlan({ seed: 42 });
    expect(plan.part1Topics).toHaveLength(2);
    expect(plan.part1Questions.length).toBe(8); // 4 + 4
    expect(plan.part2CueCard).toBeTruthy();
    expect(plan.part2CueCard.bullets).toHaveLength(4);
    expect(plan.part3Questions.length).toBeGreaterThanOrEqual(3);
    for (const p3 of plan.part3Questions) {
      expect(p3.cueCardId).toBe(plan.part2CueCard.id);
    }
  });

  it('does not repeat questions or cue cards across 3 consecutive tests', () => {
    clearSeenQuestions();

    const plan1 = generateIeltsSessionPlan({ seed: 101 });
    const plan2 = generateIeltsSessionPlan({ seed: 102 });
    const plan3 = generateIeltsSessionPlan({ seed: 103 });

    // Part 1 Questions (8 per test) -> 24 unique questions across 3 tests
    const p1Ids1 = plan1.part1Questions.map((q) => q.id);
    const p1Ids2 = plan2.part1Questions.map((q) => q.id);
    const p1Ids3 = plan3.part1Questions.map((q) => q.id);

    const allP1 = [...p1Ids1, ...p1Ids2, ...p1Ids3];
    expect(allP1).toHaveLength(24);
    expect(new Set(allP1).size).toBe(24);

    // Part 2 Cue Cards (1 per test) -> 3 unique cue cards
    const ccIds = [plan1.part2CueCard.id, plan2.part2CueCard.id, plan3.part2CueCard.id];
    expect(new Set(ccIds).size).toBe(3);

    // Part 3 Questions (3 per test) -> 9 unique questions
    const p3Ids1 = plan1.part3Questions.map((q) => q.id);
    const p3Ids2 = plan2.part3Questions.map((q) => q.id);
    const p3Ids3 = plan3.part3Questions.map((q) => q.id);

    const allP3 = [...p3Ids1, ...p3Ids2, ...p3Ids3];
    expect(allP3).toHaveLength(9);
    expect(new Set(allP3).size).toBe(9);
  });

  it('persists seen question and cue card IDs to localStorage', () => {
    clearSeenQuestions();
    const plan = generateIeltsSessionPlan();

    const raw = localStorage.getItem(SEEN_QUESTIONS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    const state = getSeenQuestions();
    expect(state.seenCueCardIds).toContain(plan.part2CueCard.id);
    expect(state.seenPart1Ids.length).toBe(8);
    for (const q of plan.part1Questions) {
      expect(state.seenPart1Ids).toContain(q.id);
    }
  });

  it('resets the seen set only when the pool is exhausted', () => {
    clearSeenQuestions();

    // Pool of cue cards has 15 items
    const usedCards = new Set<string>();
    for (let i = 0; i < 15; i++) {
      const plan = generateIeltsSessionPlan({ seed: i });
      usedCards.add(plan.part2CueCard.id);
    }
    expect(usedCards.size).toBe(15);

    // On 16th test, pool was exhausted, so seen set resets and smoothly generates next test
    const plan16 = generateIeltsSessionPlan({ seed: 16 });
    expect(plan16.part2CueCard).toBeDefined();
    expect(PART_2_CUE_CARDS.map((c) => c.id)).toContain(plan16.part2CueCard.id);
  });

  it('getReplacementUnseenQuestion replaces question with an unseen one from the bank', () => {
    clearSeenQuestions();
    const plan = generateIeltsSessionPlan();
    const currentQ = plan.part1Questions[0];

    const replacement = getReplacementUnseenQuestion({
      part: 1,
      currentQuestionId: currentQ.id,
      topic: currentQ.topic,
      excludeIds: plan.part1Questions.map((q) => q.id)
    });

    expect(replacement.id).not.toBe(currentQ.id);
    expect(plan.part1Questions.map((q) => q.id)).not.toContain(replacement.id);
    expect(getSeenQuestions().seenPart1Ids).toContain(replacement.id);
  });
});
