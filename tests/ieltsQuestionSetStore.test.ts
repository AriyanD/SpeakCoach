import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';
import {
  getIeltsQuestionSets,
  getPreviousIeltsQuestionSetGenerationCount,
  replaceUncompletedIeltsQuestionSets,
  restorePreviousIeltsQuestionSets,
  exportIeltsQuestionSetSnapshot,
  importIeltsQuestionSetSnapshot,
  getIeltsQuestionStoreRecoveryNotices,
  addIeltsQuestionSets
} from '../src/services/ieltsQuestionSetStore';

function batch(prefix: string) {
  return Array.from({ length: 2 }, (_, index) => {
    const plan = generateIeltsSessionPlan({ preferUnseen: false });
    plan.id = `${prefix}-${index}-${Date.now()}`;
    plan.part1Questions = plan.part1Questions.map((question, qIndex) => ({
      ...question,
      id: `${prefix}-p1-${index}-${qIndex}`,
      question: `${prefix} unique question ${index} ${qIndex}: ${question.question}`
    }));
    plan.part2CueCard = {
      ...plan.part2CueCard,
      id: `${prefix}-p2-${index}`,
      prompt: `${prefix} unique cue card ${index}: ${plan.part2CueCard.prompt}`
    };
    plan.part3Questions = plan.part3Questions.map((question, qIndex) => ({
      ...question,
      id: `${prefix}-p3-${index}-${qIndex}`,
      question: `${prefix} unique discussion ${index} ${qIndex}: ${question.question}`
    }));
    return { plan };
  });
}

describe('IELTS previous question-set generations', () => {
  beforeEach(() => localStorage.clear());

  it('restores the previous pending batch and keeps the replaced batch recoverable', () => {
    const first = replaceUncompletedIeltsQuestionSets(batch('first'));
    const second = replaceUncompletedIeltsQuestionSets(batch('second'));

    expect(getIeltsQuestionSets().filter(set => set.status === 'new').map(set => set.id)).toEqual(second.map(set => set.plan.id));
    expect(getPreviousIeltsQuestionSetGenerationCount()).toBe(1);

    const restored = restorePreviousIeltsQuestionSets();
    expect(restored?.map(set => set.id)).toEqual(first.map(set => set.plan.id));
    expect(getIeltsQuestionSets().filter(set => set.status === 'new').map(set => set.id)).toEqual(first.map(set => set.plan.id));

    const swappedBack = restorePreviousIeltsQuestionSets();
    expect(swappedBack?.map(set => set.id)).toEqual(second.map(set => set.plan.id));
  });

  it('keeps completed sets while replacing and restoring only pending sets', () => {
    const completed = replaceUncompletedIeltsQuestionSets(batch('completed'));
    completed[0].status = 'completed';
    localStorage.setItem('speakcoach_ielts_question_sets_v1', JSON.stringify(completed));

    const pending = replaceUncompletedIeltsQuestionSets(batch('pending'));
    expect(getIeltsQuestionSets().filter(set => set.status === 'completed')).toHaveLength(1);
    restorePreviousIeltsQuestionSets();
    expect(getIeltsQuestionSets().filter(set => set.status === 'completed').map(set => set.id)).toEqual([completed[0].id]);
    expect(getIeltsQuestionSets().filter(set => set.status === 'new').map(set => set.id)).toEqual(completed.slice(1).map(set => set.id));
    expect(pending).toHaveLength(2);
  });
});


describe('IELTS generated question library backup', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips current and previous generated sets', () => {
    const first = replaceUncompletedIeltsQuestionSets(batch('backup-first'));
    const second = replaceUncompletedIeltsQuestionSets(batch('backup-second'));
    const snapshot = exportIeltsQuestionSetSnapshot();

    localStorage.clear();
    importIeltsQuestionSetSnapshot(snapshot);

    expect(getIeltsQuestionSets().map(set => set.id)).toEqual(second.map(item => item.plan.id));
    expect(getPreviousIeltsQuestionSetGenerationCount()).toBe(1);
    expect(restorePreviousIeltsQuestionSets()?.map(set => set.id)).toEqual(first.map(item => item.plan.id));
  });

  it('rejects malformed snapshots without changing existing sets', () => {
    const existing = replaceUncompletedIeltsQuestionSets(batch('keep-current'));
    expect(() => importIeltsQuestionSetSnapshot({ sets: [{ id: 'broken' }], previousGenerations: [] }))
      .toThrow(/invalid generated question set/i);
    expect(getIeltsQuestionSets().map(set => set.id)).toEqual(existing.map(item => item.plan.id));
  });


  it('preserves malformed question-library data before returning an empty view', () => {
    localStorage.setItem('speakcoach_ielts_question_sets_v1', '{broken json');
    expect(getIeltsQuestionSets()).toEqual([]);
    const recoveryKeys = Object.keys(localStorage).filter(key => key.startsWith('speakcoach.ielts_question_recovery.v1.'));
    expect(recoveryKeys).toHaveLength(1);
    expect(localStorage.getItem(recoveryKeys[0])).toBe('{broken json');
    expect(getIeltsQuestionStoreRecoveryNotices().length).toBeGreaterThan(0);
  });

  it('reports a question-library write failure instead of pretending sets were saved', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key: string) {
      if (key === 'speakcoach_ielts_question_sets_v1') throw new Error('quota exceeded');
      return undefined;
    });
    expect(() => addIeltsQuestionSets(batch('storage-failure'))).toThrow(/Could not save generated IELTS questions/i);
    setItem.mockRestore();
  });

});
