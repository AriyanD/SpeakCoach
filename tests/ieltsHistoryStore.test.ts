import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveIeltsTestResult,
  getIeltsTestHistory,
  getIeltsTestResult,
  deleteIeltsTestResult,
  clearIeltsTestHistory,
  deduplicateTestRecords,
  saveIeltsDraft,
  loadIeltsDraft,
  clearIeltsDraft,
  getIeltsHistoryRecoveryNotices,
  exportIeltsHistorySnapshot,
  importIeltsHistorySnapshot,
  type IeltsSessionDraft,
  type IeltsTestRecord
} from '../src/storage/ieltsHistoryStore';
import type { IeltsEvaluationResult } from '../src/services/ieltsOfflineEvaluator';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';

const mockEvaluation: IeltsEvaluationResult = {
  overallBand: 6.5,
  fluencyCoherenceBand: 6.5,
  lexicalResourceBand: 6.5,
  grammaticalRangeBand: 6.5,
  pronunciationBand: 7.0,
  pronunciationNotice: 'Estimated from speech-recognition data',
  perCriterionComments: {
    fluency: 'Good flow with occasional hesitation.',
    lexical: 'Wide vocabulary used appropriately.',
    grammar: 'Mix of simple and complex sentences.',
    pronunciation: 'Clear speech throughout.'
  },
  corrections: [
    {
      original: 'I go to library yesterday',
      corrected: 'I went to the library yesterday',
      explanation: 'Use simple past tense for completed actions in the past.'
    }
  ],
  vocabularyUpgrades: [
    {
      original: 'good',
      upgraded: 'beneficial',
      context: 'Regular exercise is beneficial for health.'
    }
  ],
  modelAnswers: [
    {
      question: 'Describe a memorable journey',
      band7ModelAnswer: 'I would like to describe a memorable journey...'
    }
  ],
  perAnswerFeedback: [],
  topPriorities: ['Maintain flow', 'Use complex sentences', 'Vary vocabulary'],
  sessionMetrics: {
    totalAnswers: 1,
    totalWords: 15,
    totalDurationSeconds: 12,
    overallWpm: 120,
    totalPauses: 2,
    totalLongPauses: 0,
    averagePauseDurationMs: 450,
    totalFillers: 1,
    topFillers: [{ word: 'um', count: 1 }],
    averageLexicalDiversity: 0.8,
    totalLinkers: 1,
    topLinkers: [{ linker: 'however', count: 1 }],
    totalRepetitions: 0
  },
  answerMetrics: [],
  activeTier: {
    slotId: 'llm_evaluator',
    providerId: 'offline_ielts_heuristics',
    providerName: 'Offline IELTS Heuristics',
    tier: 3,
    label: 'Basic offline',
    detailLabel: 'Offline heuristics',
    isFallback: false
  },
  confidenceLabel: 'estimated band, low confidence (Basic offline · Tier 3)'
};

describe('IELTS History & Draft Storage (Stage 4.1)', () => {
  beforeEach(async () => {
    await clearIeltsTestHistory();
    await clearIeltsDraft();
  });

  it('preserves malformed history JSON and exposes a recovery notice instead of silently discarding it', async () => {
    await clearIeltsTestHistory();
    const damaged = '{"records":';
    localStorage.setItem('speakcoach_ielts_history_v1', damaged);

    await expect(getIeltsTestHistory()).resolves.toEqual([]);
    expect(getIeltsHistoryRecoveryNotices().some(message => /preserved/i.test(message))).toBe(true);
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('speakcoach.ielts_history_recovery.v1.'));
    expect(recoveryKey).toBeTruthy();
    expect(localStorage.getItem(recoveryKey!)).toBe(damaged);
  });

  it('saves and retrieves completed test results, maintaining newest-first order', async () => {
    const r1 = await saveIeltsTestResult({
      mode: 'part1',
      overallBand: 6.0,
      evaluation: { ...mockEvaluation, overallBand: 6.0 },
      answers: [
        {
          questionId: 'p1_1',
          part: 'part1',
          questionText: 'Do you work or study?',
          transcript: 'I am currently working as a software engineer.',
          durationSec: 15,
          wpm: 120
        }
      ]
    });

    const r2 = await saveIeltsTestResult({
      mode: 'full',
      overallBand: 7.0,
      evaluation: { ...mockEvaluation, overallBand: 7.0 },
      answers: [
        {
          questionId: 'p2_1',
          part: 'part2',
          questionText: 'Describe a journey you remember well.',
          transcript: 'I would like to talk about my trip to Istanbul last year.',
          durationSec: 105,
          wpm: 135
        }
      ]
    });

    const history = await getIeltsTestHistory();
    expect(history.length).toBe(2);
    expect(history[0].id).toBe(r2.id); // Newest first
    expect(history[0].overallBand).toBe(7.0);
    expect(history[1].id).toBe(r1.id);
    expect(history[1].overallBand).toBe(6.0);

    // Get specific result by ID
    const fetched = await getIeltsTestResult(r1.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.mode).toBe('part1');
    expect(fetched?.answers[0].questionId).toBe('p1_1');
  });

  it('stores exact question plans and preserves repeated attempts as separate linked records', async () => {
    const plan = generateIeltsSessionPlan({ preferUnseen: false });
    plan.id = 'repeatable-question-set-1';
    const answer = {
      questionId: 'same-question-1',
      part: 'part1' as const,
      questionText: 'What do you enjoy about your neighbourhood?',
      transcript: 'I enjoy the parks and the quiet streets.',
      durationSec: 18
    };
    const first = await saveIeltsTestResult({
      id: 'repeat-attempt-1',
      mode: 'full',
      overallBand: 6.0,
      evaluation: { ...mockEvaluation, overallBand: 6.0 },
      answers: [answer],
      plan,
      questionSetId: plan.id
    });
    const second = await saveIeltsTestResult({
      id: 'repeat-attempt-2',
      mode: 'full',
      overallBand: 6.5,
      evaluation: { ...mockEvaluation, overallBand: 6.5 },
      answers: [answer],
      plan,
      questionSetId: plan.id
    });

    const history = await getIeltsTestHistory();
    expect(history).toHaveLength(2);
    expect(second.plan?.id).toBe(plan.id);
    expect(second.attemptNumber).toBe(2);
    expect(second.previousAttemptId).toBe(first.id);
    expect((await getIeltsTestResult(first.id))?.plan?.id).toBe(plan.id);
  });

  it('preserves multiple evaluation versions through updates and test-data backup restore', async () => {
    const original = await saveIeltsTestResult({
      id: 're-evaluation-history-test',
      mode: 'part1',
      overallBand: 6.5,
      evaluation: { ...mockEvaluation, overallBand: 6.5 },
      answers: [{
        questionId: 'q1',
        part: 'part1',
        questionText: 'What do you enjoy about your work?',
        transcript: 'I enjoy working with people and solving problems.',
        durationSec: 18
      }]
    });

    const firstEvaluation = {
      id: 'evaluation-api-1',
      evaluatedAt: Date.now(),
      mode: 'api' as const,
      providerChoice: 'primary' as const,
      providerId: 'openai_compat_eval',
      providerName: 'API 1',
      result: { ...mockEvaluation, overallBand: 6.5 }
    };
    await saveIeltsTestResult({
      ...original,
      evaluationHistory: [firstEvaluation]
    });

    // A later update that omits the optional field must not erase stored versions.
    await saveIeltsTestResult({
      ...original,
      overallBand: 7.0,
      evaluation: { ...mockEvaluation, overallBand: 7.0 }
    });

    const saved = await getIeltsTestResult(original.id);
    expect(saved?.evaluationHistory).toHaveLength(1);
    expect(saved?.evaluationHistory?.[0].providerName).toBe('API 1');

    const snapshot = await exportIeltsHistorySnapshot();
    await clearIeltsTestHistory();
    await importIeltsHistorySnapshot(snapshot);

    const restored = await getIeltsTestResult(original.id);
    expect(restored?.evaluationHistory).toHaveLength(1);
    expect(restored?.evaluationHistory?.[0].result.overallBand).toBe(6.5);
    expect(restored?.overallBand).toBe(7.0);
  });

  it('deletes an individual test record from history', async () => {
    const r1 = await saveIeltsTestResult({
      mode: 'part2',
      overallBand: 6.5,
      evaluation: mockEvaluation,
      answers: []
    });
    const r2 = await saveIeltsTestResult({
      mode: 'part3',
      overallBand: 7.5,
      evaluation: mockEvaluation,
      answers: []
    });

    await deleteIeltsTestResult(r1.id);
    const history = await getIeltsTestHistory();
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(r2.id);

    const checkDeleted = await getIeltsTestResult(r1.id);
    expect(checkDeleted).toBeNull();
  });

  it('preserves an active session draft when updating an existing historical result', async () => {
    const original = await saveIeltsTestResult({
      id: 'historical-result-update-with-active-draft',
      mode: 'part1',
      overallBand: 6.5,
      evaluation: mockEvaluation,
      answers: []
    });
    const plan = generateIeltsSessionPlan();
    const draft: IeltsSessionDraft = {
      mode: 'part2',
      plan,
      currentStepIndex: 2,
      candidateNotes: 'Keep this active session intact',
      completedAnswers: [],
      updatedAt: Date.now()
    };
    await saveIeltsDraft(draft);

    await saveIeltsTestResult(
      { ...original, comparisonError: 'Comparison is pending' },
      { clearDraft: false }
    );

    await expect(loadIeltsDraft()).resolves.toMatchObject({
      candidateNotes: 'Keep this active session intact',
      currentStepIndex: 2
    });
  });

  it('saves, loads, and clears session drafts for interruption recovery', async () => {
    expect(await loadIeltsDraft()).toBeNull();

    const plan = generateIeltsSessionPlan();
    const draft: IeltsSessionDraft = {
      mode: 'part2',
      plan,
      currentStepIndex: 0,
      candidateNotes: '1. Istanbul trip\n2. Bosphorus cruise\n3. Friendly people',
      completedAnswers: [],
      updatedAt: Date.now()
    };

    await saveIeltsDraft(draft);
    const loaded = await loadIeltsDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.candidateNotes).toBe('1. Istanbul trip\n2. Bosphorus cruise\n3. Friendly people');
    expect(loaded?.mode).toBe('part2');

    // Saving a completed test automatically clears active draft
    await saveIeltsTestResult({
      mode: 'part2',
      overallBand: 6.5,
      evaluation: mockEvaluation,
      answers: []
    });

    expect(await loadIeltsDraft()).toBeNull();
  });

  it('guarantees idempotent saves when called repeatedly with the same session id', async () => {
    const fixedId = 'test_session_idempotent_123';
    for (let i = 0; i < 5; i++) {
      await saveIeltsTestResult({
        id: fixedId,
        mode: 'part1',
        overallBand: 6.5,
        evaluation: mockEvaluation,
        answers: [
          {
            questionId: 'p1_1',
            part: 'part1',
            questionText: 'Do you study or work?',
            transcript: 'I work.',
            durationSec: 5
          }
        ]
      });
    }

    const history = await getIeltsTestHistory();
    // Must contain exactly 1 entry, not 5!
    expect(history.filter((h) => h.id === fixedId)).toHaveLength(1);
  });

  it('preserves distinct attempts even when answers are identical and timestamps are close', async () => {
    const now = Date.now();
    const records: IeltsTestRecord[] = [
      {
        id: 'rec_1',
        timestamp: now,
        mode: 'part1',
        overallBand: 6.0,
        evaluation: mockEvaluation,
        answers: [
          {
            questionId: 'p1_1',
            part: 'part1',
            questionText: 'Do you work?',
            transcript: 'Yes, as a teacher.',
            durationSec: 10
          }
        ]
      },
      {
        id: 'rec_2_dup',
        timestamp: now + 500, // 0.5s later, identical content
        mode: 'part1',
        overallBand: 6.0,
        evaluation: mockEvaluation,
        answers: [
          {
            questionId: 'p1_1',
            part: 'part1',
            questionText: 'Do you work?',
            transcript: 'Yes, as a teacher.',
            durationSec: 10
          }
        ]
      },
      {
        id: 'rec_3_different',
        timestamp: now + 60000,
        mode: 'part2',
        overallBand: 7.0,
        evaluation: { ...mockEvaluation, overallBand: 7.0 },
        answers: []
      }
    ];

    const deduped = deduplicateTestRecords(records);
    expect(deduped).toHaveLength(3);
    expect(deduped[0].id).toBe('rec_1');
    expect(deduped[1].id).toBe('rec_2_dup');
    expect(deduped[2].id).toBe('rec_3_different');
  });

  it('does not truncate imported history after the next completed test is saved', async () => {
    const base = await saveIeltsTestResult({
      id: 'history-retention-seed',
      mode: 'part1',
      overallBand: 6.0,
      evaluation: mockEvaluation,
      answers: [{
        questionId: 'p1_1',
        part: 'part1',
        questionText: 'Seed question',
        transcript: 'Seed answer',
        durationSec: 15,
        wpm: 120
      }]
    });
    const importedHistory = Array.from({ length: 60 }, (_, index) => ({
      ...base,
      id: `backup-record-${index}`,
      timestamp: Date.now() - index * 1000,
      answers: base.answers.map((answer) => ({
        ...answer,
        questionText: `Question ${index}`,
        transcript: `Unique answer ${index}`
      }))
    }));

    await importIeltsHistorySnapshot({ history: importedHistory });
    await saveIeltsTestResult({
      ...base,
      id: 'after-import-save',
      timestamp: Date.now() + 1000,
      answers: [{
        questionId: 'p1_new',
        part: 'part1',
        questionText: 'A new question after restore',
        transcript: 'A new answer after restore',
        durationSec: 20,
        wpm: 125
      }]
    });

    expect(await getIeltsTestHistory()).toHaveLength(61);
  });

  it('clears all test history when clearIeltsTestHistory is called', async () => {
    await saveIeltsTestResult({
      mode: 'part1',
      overallBand: 6.0,
      evaluation: mockEvaluation,
      answers: []
    });
    await saveIeltsTestResult({
      mode: 'part2',
      overallBand: 7.0,
      evaluation: mockEvaluation,
      answers: []
    });

    expect((await getIeltsTestHistory()).length).toBe(2);
    await clearIeltsTestHistory();
    expect((await getIeltsTestHistory()).length).toBe(0);
  });
});
