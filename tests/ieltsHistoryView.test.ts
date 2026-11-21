import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderIeltsHistoryView } from '../src/ui/IeltsHistoryView';
import {
  saveIeltsTestResult,
  clearIeltsTestHistory,
  getIeltsTestHistory
} from '../src/storage/ieltsHistoryStore';
import type { IeltsEvaluationResult } from '../src/services/ieltsOfflineEvaluator';
import { bootstrapApp } from '../src/main';
import { generateIeltsSessionPlan } from './fixtures/legacyIeltsQuestionBank';

const mockEval: IeltsEvaluationResult = {
  overallBand: 7.0,
  fluencyCoherenceBand: 7.0,
  lexicalResourceBand: 7.0,
  grammaticalRangeBand: 7.0,
  pronunciationBand: null,
  pronunciationNotice: 'Not assessed. Speech-recognition confidence is not an IELTS pronunciation measure.',
  perCriterionComments: {
    fluency: 'Speaks readily.',
    lexical: 'Good resource.',
    grammar: 'Good structures.',
    pronunciation: 'Not assessed.'
  },
  corrections: [],
  vocabularyUpgrades: [],
  modelAnswers: [],
  perAnswerFeedback: [],
  topPriorities: ['Maintain fluency', 'Use varied structures', 'Precise pronunciation'],
  sessionMetrics: {
    totalAnswers: 1,
    totalWords: 20,
    totalDurationSeconds: 15,
    overallWpm: 120,
    totalPauses: 1,
    totalLongPauses: 0,
    averagePauseDurationMs: 400,
    totalFillers: 0,
    topFillers: [],
    averageLexicalDiversity: 0.85,
    totalLinkers: 0,
    topLinkers: [],
    totalRepetitions: 0
  },
  answerMetrics: [],
  activeTier: {
    slotId: 'llm_evaluator',
    providerId: 'openai_chat',
    providerName: 'Online AI evaluator',
    tier: 1,
    label: 'Online AI',
    detailLabel: 'Online AI practice estimate',
    isFallback: false
  },
  confidenceLabel: 'AI practice estimate — not an official IELTS score'
};

describe('IeltsHistoryView Component & Tab Integration (Stage 4.4)', () => {
  let container: HTMLElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    await clearIeltsTestHistory();
  });

  it('renders clean empty state when no history exists and calls onBackToTest', async () => {
    const onSelectResult = vi.fn();
    const onBackToTest = vi.fn();

    await renderIeltsHistoryView(container, { onSelectResult, onBackToTest });

    expect(container.innerHTML).toContain('No practice history yet');
    expect(container.innerHTML).toContain('Start a mock test');

    container.querySelector<HTMLButtonElement>('#history-start-first-btn')?.click();
    expect(onBackToTest).toHaveBeenCalledTimes(1);
  });

  it('renders test record cards with scores and handles View Report and Delete actions', async () => {
    const r1 = await saveIeltsTestResult({
      mode: 'part1',
      overallBand: 6.5,
      evaluation: { ...mockEval, overallBand: 6.5 },
      answers: []
    });

    const onSelectResult = vi.fn();
    const onBackToTest = vi.fn();

    await renderIeltsHistoryView(container, { onSelectResult, onBackToTest });

    expect(container.innerHTML).toContain('1 completed session recorded');
    expect(container.innerHTML).toContain('Part 1');
    expect(container.innerHTML).toContain('6.5');

    // Click view report
    const viewBtn = container.querySelector<HTMLButtonElement>('.history-view-btn');
    expect(viewBtn).not.toBeNull();
    viewBtn?.click();
    expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ id: r1.id }));

    const deleteBtn = container.querySelector<HTMLButtonElement>('.history-delete-btn');
    expect(deleteBtn).not.toBeNull();
    deleteBtn?.click();
    document.querySelector<HTMLButtonElement>('.sc-dialog-actions .btn-danger')?.click();

    // Allow async deletion and refresh
    await new Promise((resolve) => setTimeout(resolve, 50));
    const history = await getIeltsTestHistory();
    expect(history.length).toBe(0);
  });


  it('renders an independent inline re-evaluation status for scored history records', async () => {
    await saveIeltsTestResult({
      id: 'history-scored-inline-status',
      mode: 'part1',
      overallBand: 7.0,
      evaluation: { ...mockEval, overallBand: 7.0 },
      answers: [{
        questionId: 'q1',
        part: 'part1',
        questionText: 'Do you work or study?',
        transcript: 'I teach service design at a university.',
        durationSec: 14
      }]
    });
    await renderIeltsHistoryView(container, { onSelectResult: vi.fn(), onBackToTest: vi.fn() });
    expect(container.querySelector('.ielts-history-band')?.textContent?.trim()).toBe('7.0');
    const status = container.querySelector<HTMLElement>('.history-reevaluation-status');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  it('uses the three-option re-evaluation menu in history and visually separates bulk deletion', async () => {
    await saveIeltsTestResult({
      id: 'history-reevaluation-menu',
      mode: 'part1',
      overallBand: null,
      evaluation: null,
      answers: [{
        questionId: 'q1',
        part: 'part1',
        questionText: 'Do you work or study?',
        transcript: 'I work as a designer.',
        durationSec: 12,
        wpm: 120
      }]
    });
    await renderIeltsHistoryView(container, {
      onSelectResult: vi.fn(),
      onBackToTest: vi.fn()
    });
    const choice = container.querySelector<HTMLSelectElement>('.history-api-choice');
    expect(Array.from(choice?.options ?? []).map(option => option.value)).toEqual([
      'auto', 'primary', 'secondary'
    ]);
    expect(container.querySelector('.history-retry-btn')?.textContent).toBe('Re-evaluate');
    expect(container.querySelector('.history-offline-btn')).toBeNull();
    expect(container.querySelector('.history-delete-btn')?.textContent?.trim()).toBe('Delete');
    expect(container.querySelector('#history-clear-all-btn')?.classList.contains('btn-danger')).toBe(true);
    expect(container.querySelector('#history-clear-all-btn svg')).not.toBeNull();
  });

  it('offers an exact repeat action when a saved question plan is available', async () => {
    const plan = generateIeltsSessionPlan({ preferUnseen: false });
    plan.id = 'history-repeat-plan';
    const record = await saveIeltsTestResult({
      id: 'history-repeat-attempt',
      mode: 'full',
      overallBand: 6.5,
      evaluation: { ...mockEval, overallBand: 6.5 },
      answers: [],
      plan,
      questionSetId: plan.id
    });
    const onRepeatTest = vi.fn();
    await renderIeltsHistoryView(container, {
      onSelectResult: vi.fn(),
      onBackToTest: vi.fn(),
      onRepeatTest
    });
    const repeatButton = container.querySelector<HTMLButtonElement>('.history-repeat-btn');
    expect(repeatButton).not.toBeNull();
    repeatButton?.click();
    expect(onRepeatTest).toHaveBeenCalledWith(expect.objectContaining({ id: record.id, plan }));
  });

  it('hides legacy scores that included an unvalidated pronunciation estimate', async () => {
    await saveIeltsTestResult({
      id: 'history-legacy-pronunciation-score',
      mode: 'part1',
      overallBand: 7.0,
      evaluation: { ...mockEval, pronunciationBand: 7.0, pronunciationNotice: 'Legacy ASR confidence estimate' },
      answers: []
    });

    await renderIeltsHistoryView(container, { onSelectResult: vi.fn(), onBackToTest: vi.fn() });

    expect(container.innerHTML).toContain('Legacy score hidden');
    expect(container.querySelector('.ielts-history-band')?.textContent?.trim()).toBe('—');
    expect(container.innerHTML).toContain('not a valid IELTS pronunciation measure');
    // This legacy record has no saved answer transcript, so it cannot be re-evaluated.
    expect(container.querySelector('.history-retry-btn')).toBeNull();
  });

  it('renders offline test record with objective stats and no band score without AI evaluation', async () => {
    await saveIeltsTestResult({
      id: 'history-offline-1',
      mode: 'part1',
      overallBand: null,
      evaluation: {
        overallBand: null,
        pronunciationNotice: 'No acoustic band score without AI evaluation.',
        perCriterionComments: { fluency: '', lexical: '', grammar: '', pronunciation: '' },
        corrections: [],
        vocabularyUpgrades: [],
        modelAnswers: [],
        perAnswerFeedback: [],
        topPriorities: ['Pacing', 'Detail', 'Grammar'],
        sessionMetrics: {
          totalAnswers: 2,
          totalWords: 40,
          totalDurationSeconds: 25,
          overallWpm: 96,
          totalPauses: 3,
          totalLongPauses: 0,
          averagePauseDurationMs: 400,
          totalFillers: 1,
          topFillers: [],
          averageLexicalDiversity: 0.8,
          totalLinkers: 1,
          topLinkers: [],
          totalRepetitions: 0
        },
        answerMetrics: [],
        activeTier: {
          slotId: 'llm_evaluator',
          providerId: 'offline_rule_eval',
          providerName: 'Rule-Based Offline Evaluator',
          tier: 3,
          label: 'Basic offline',
          detailLabel: 'Basic offline',
          isFallback: false
        },
        confidenceLabel: 'no band score without AI evaluation',
        noScoreNotice: 'no band score without AI evaluation'
      },
      answers: [
        {
          questionId: 'q1',
          part: 'part1',
          questionText: 'Do you work or study?',
          transcript: 'I work in marketing.',
          durationSec: 10,
          wpm: 96
        }
      ]
    });

    await renderIeltsHistoryView(container, {
      onSelectResult: vi.fn(),
      onBackToTest: vi.fn()
    });

    expect(container.innerHTML).toContain('An AI evaluator was not available, so this report shows speech statistics only.');
    expect(container.innerHTML).toContain('WPM:');
    expect(container.innerHTML).toContain('96');
    expect(container.innerHTML).toContain('Pauses:');
    expect(container.innerHTML).toContain('3');
    expect(container.innerHTML).toContain('Fillers:');
    expect(container.innerHTML).toContain('1');
    expect(container.innerHTML).toContain('Words:');
    expect(container.innerHTML).toContain('40');
  });

  it('bootstraps main app with IELTS tab support and bottom navigation', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    await bootstrapApp(root, 'shadowing');

    // Check nav buttons
    const navIelts = root.querySelector<HTMLButtonElement>('#nav-ielts');
    expect(navIelts).not.toBeNull();
    expect(navIelts?.textContent).toContain('IELTS');

    // The redundant Home screen is removed; IELTS is opened directly from the three-item navigation.
    expect(root.querySelectorAll('.nav-btn')).toHaveLength(3);
    expect(root.innerHTML).not.toContain('home-open-ielts-btn');

    // Click IELTS nav button
    navIelts?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(root.innerHTML).toContain('Question sets');
  });

  it('escapes untrusted history record IDs before inserting them into HTML attributes', async () => {
    const hostileId = 'record"><img src=x onerror=alert(1)>';
    await saveIeltsTestResult({
      id: hostileId,
      mode: 'part1',
      overallBand: null,
      evaluation: null,
      answers: [{
        questionId: 'q1',
        part: 'part1',
        questionText: 'A safe question',
        transcript: 'A sufficiently long answer for a retry.',
        durationSec: 12
      }]
    });

    const onRetryEvaluation = vi.fn().mockResolvedValue(undefined);
    await renderIeltsHistoryView(container, {
      onSelectResult: () => {},
      onBackToTest: () => {},
      onRetryEvaluation
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const record = container.querySelector<HTMLElement>('.ielts-history-record');
    expect(record?.getAttribute('data-record-id')).toBe(hostileId);
    expect(container.querySelector<HTMLButtonElement>('.history-view-btn')?.dataset.id).toBe(hostileId);
    container.querySelector<HTMLButtonElement>('.history-retry-btn')?.click();
    await vi.waitFor(() => expect(onRetryEvaluation).toHaveBeenCalledOnce());
  });

});
