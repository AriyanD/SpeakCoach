import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderIeltsResultView } from '../src/ui/IeltsResultView';
import type { IeltsTestRecord } from '../src/storage/ieltsHistoryStore';
import { getLastIeltsEvaluation, clearIeltsTelemetry } from '../src/services/ieltsTelemetry';

const mockTestRecord: IeltsTestRecord = {
  id: 'test_rec_123',
  timestamp: 1773000000000,
  mode: 'full',
  overallBand: 7.5,
  evaluation: {
    overallBand: 7.5,
    fluencyCoherenceBand: 7.5,
    lexicalResourceBand: 8.0,
    grammaticalRangeBand: 7.0,
    pronunciationBand: null,
    pronunciationNotice: 'Not assessed. The available speech-recognition output cannot validly measure IELTS pronunciation.',
    perCriterionComments: {
      fluency: 'Speaks at length effortlessly with rare hesitation.',
      lexical: 'Uses a wide vocabulary readily and flexibly.',
      grammar: 'Uses a range of complex structures with good control.',
      pronunciation: 'Not assessed. Speech-recognition confidence is not an IELTS pronunciation measure.'
    },
    corrections: [
      {
        original: 'She do not know',
        corrected: 'She does not know',
        explanation: 'Third person singular requires "does not".'
      }
    ],
    vocabularyUpgrades: [
      {
        original: 'big',
        upgraded: 'substantial',
        context: 'There was a substantial increase in public transit usage.'
      }
    ],
    modelAnswers: [
      {
        question: 'Describe a captivating journey',
        band7ModelAnswer: 'I would like to speak about a captivating journey across the mountains...'
      }
    ],
    perAnswerFeedback: [],
    topPriorities: ['Complex compound structures', 'Idiomatic phrases', 'Pacing'],
    sessionMetrics: {
      totalAnswers: 1,
      totalWords: 15,
      totalDurationSeconds: 10,
      overallWpm: 125,
      totalPauses: 1,
      totalLongPauses: 0,
      averagePauseDurationMs: 400,
      totalFillers: 0,
      topFillers: [],
      averageLexicalDiversity: 0.9,
      totalLinkers: 1,
      topLinkers: [{ linker: 'furthermore', count: 1 }],
      totalRepetitions: 0
    },
    answerMetrics: [],
    activeTier: {
      slotId: 'llm_evaluator',
      providerId: 'openai_chat',
      providerName: 'OpenAI (GPT-4o-mini)',
      tier: 1,
      label: 'Online AI',
      detailLabel: 'OpenAI GPT-4o-mini',
      isFallback: false
    },
    confidenceLabel: 'AI practice estimate — not an official IELTS score'
  },
  answers: [
    {
      questionId: 'p1_1',
      part: 'part1',
      questionText: 'Do you prefer morning or evening?',
      transcript: 'I definitely prefer morning because I feel most energetic.',
      durationSec: 18,
      wpm: 125
    }
  ]
};

describe('IeltsResultView Component (Stage 4.3)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    clearIeltsTelemetry();
  });


  it('shows re-evaluation failures inline without hiding an existing band score', async () => {
    renderIeltsResultView(container, mockTestRecord, {
      onRetake: () => {},
      onBackToHistory: () => {},
      onRetryEvaluation: async () => { throw new Error('API 2 is not ready: verification expired.'); }
    });
    const status = container.querySelector<HTMLElement>('#result-reevaluation-status');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-live')).toBe('polite');
    container.querySelector<HTMLButtonElement>('#result-retry-eval-btn')?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(status?.textContent).toContain('API 2 is not ready');
    expect(container.querySelector('#result-overall-band')?.textContent).toContain('7.5');
  });

  it('renders a three-criterion practice estimate and marks pronunciation as not assessed', () => {
    const onRetake = vi.fn();
    const onBackToHistory = vi.fn();

    renderIeltsResultView(container, mockTestRecord, { onRetake, onBackToHistory });

    const bandBadge = container.querySelector('#result-overall-band');
    expect(bandBadge?.textContent?.trim()).toBe('7.5');
    expect(container.innerHTML).toContain('Fluency &amp; Coherence');
    expect(container.innerHTML).toContain('Speaks at length effortlessly');
    expect(container.innerHTML).toContain('Lexical Resource');
    expect(container.innerHTML).toContain('Grammar &amp; Accuracy');
    expect(container.innerHTML).toContain('Pronunciation');
    expect(container.innerHTML).toContain('(Not assessed)');
    expect(container.innerHTML).toContain('Online AI practice estimate');
    expect(container.querySelector('.ielts-band-ring')).not.toBeNull();
    expect(container.querySelectorAll('.ielts-criterion-row')).toHaveLength(4);
    expect(container.querySelector('.ielts-next-focus')?.textContent).toContain('Grammar & Accuracy');
  });

  it('hides a legacy overall score that included an unvalidated pronunciation estimate', () => {
    const legacyRecord: IeltsTestRecord = {
      ...mockTestRecord,
      overallBand: 7.5,
      evaluation: {
        ...mockTestRecord.evaluation!,
        pronunciationBand: 7.5,
        pronunciationNotice: 'Legacy ASR confidence estimate'
      }
    };
    renderIeltsResultView(container, legacyRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    expect(container.querySelector('#result-overall-band')?.textContent?.trim()).toBe('—');
    expect(container.textContent).toContain('Legacy score hidden');
    expect(container.textContent).toContain('not a valid pronunciation assessment');
    expect(container.querySelector('#result-retry-eval-btn')).not.toBeNull();
  });

  it('offers four re-evaluation methods in one dropdown and one Re-evaluate button', () => {
    renderIeltsResultView(container, mockTestRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });
    const choice = container.querySelector<HTMLSelectElement>('#result-api-choice');
    expect(Array.from(choice?.options ?? []).map(option => option.value)).toEqual([
      'auto', 'primary', 'secondary'
    ]);
    expect(container.querySelector('#result-retry-eval-btn')?.textContent).toBe('Re-evaluate');
    expect(container.querySelector('#result-offline-eval-btn')).toBeNull();
    expect(container.textContent).toContain('The first API evaluation runs automatically after the test');
    expect(container.textContent).toContain('API 1 or API 2');
    expect(container.textContent).not.toContain('Offline evaluation');
  });

  it('provides a single copyable text block with every question and answer', () => {
    renderIeltsResultView(container, mockTestRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    const exportArea = container.querySelector<HTMLTextAreaElement>('#ielts-export-text');
    expect(exportArea).not.toBeNull();
    expect(exportArea?.value).toContain('Do you prefer morning or evening?');
    expect(exportArea?.value).toContain('I definitely prefer morning because I feel most energetic.');
    expect(container.textContent).toContain('For external analysis outside the app, if needed.');
  });

  it('renders educational feedback: grammar corrections, vocabulary upgrades, and model answers', () => {
    renderIeltsResultView(container, mockTestRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    expect(container.innerHTML).toContain('Grammar corrections');
    expect(container.innerHTML).toContain('She do not know');
    expect(container.innerHTML).toContain('She does not know');

    expect(container.innerHTML).toContain('Vocabulary upgrades');
    expect(container.innerHTML).toContain('substantial');

    expect(container.innerHTML).toContain('Band 7–9 model answers');
    expect(container.innerHTML).toContain('captivating journey across the mountains');

    expect(container.innerHTML).toContain('Your spoken answers (1)');
    expect(container.innerHTML).toContain('I definitely prefer morning');
  });

  it('invokes retake and back-to-history callbacks and records telemetry', async () => {
    const onRetake = vi.fn();
    const onBackToHistory = vi.fn();
    const onReturnToMenu = vi.fn();

    renderIeltsResultView(container, mockTestRecord, { onRetake, onBackToHistory, onReturnToMenu });

    const retakeBtn = container.querySelector<HTMLButtonElement>('#result-retake-btn');
    expect(retakeBtn?.textContent).toContain('Start New Test');
    expect(retakeBtn?.classList.contains('btn-primary')).toBe(true);
    retakeBtn?.click();
    expect(onRetake).toHaveBeenCalledTimes(1);

    const menuBtn = container.querySelector<HTMLButtonElement>('#result-menu-btn');
    expect(menuBtn?.textContent).toContain('Return to Menu');
    menuBtn?.click();
    expect(onReturnToMenu).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('#result-history-btn')?.click();
    expect(onBackToHistory).toHaveBeenCalledTimes(1);

    const telemetry = await getLastIeltsEvaluation();
    expect(telemetry).not.toBeNull();
    expect(telemetry?.overallBand).toBe(7.5);
    expect(telemetry?.id).toBe('test_rec_123');
  });

  it('renders Start New Test and Return to Menu buttons in retryable / failed evaluation state', () => {
    const failedEvalRecord: IeltsTestRecord = {
      ...mockTestRecord,
      id: 'test_rec_failed',
      overallBand: null,
      evaluation: null,
      evaluationError: 'AI Evaluator connection timed out.'
    };
    const onRetake = vi.fn();
    const onReturnToMenu = vi.fn();
    const onBackToHistory = vi.fn();

    renderIeltsResultView(container, failedEvalRecord, { onRetake, onBackToHistory, onReturnToMenu });

    const retakeBtn = container.querySelector<HTMLButtonElement>('#result-retake-btn');
    const retryBtn = container.querySelector<HTMLButtonElement>('#result-retry-eval-btn');
    expect(retakeBtn?.textContent).toContain('Start New Test');
    expect(retakeBtn?.classList.contains('btn-secondary')).toBe(true);
    expect(retryBtn?.classList.contains('btn-primary')).toBe(true);
    retakeBtn?.click();
    expect(onRetake).toHaveBeenCalledTimes(1);

    const menuBtn = container.querySelector<HTMLButtonElement>('#result-menu-btn');
    expect(menuBtn?.textContent).toContain('Return to Menu');
    menuBtn?.click();
    expect(onReturnToMenu).toHaveBeenCalledTimes(1);
  });

  it('renders offline evaluation with objective stats (WPM, pauses, fillers, word count, answer count) and no band score without AI evaluation', () => {
    const offlineRecord: IeltsTestRecord = {
      id: 'test_rec_offline',
      timestamp: 1773000000000,
      mode: 'part1',
      overallBand: null,
      evaluation: {
        overallBand: null,
        fluencyCoherenceBand: null,
        lexicalResourceBand: null,
        grammaticalRangeBand: null,
        pronunciationBand: null,
        pronunciationNotice: 'No acoustic band score without AI evaluation.',
        perCriterionComments: {
          fluency: 'Objective metrics captured.',
          lexical: 'Objective metrics captured.',
          grammar: 'Objective metrics captured.',
          pronunciation: 'Objective metrics captured.'
        },
        corrections: [],
        vocabularyUpgrades: [],
        modelAnswers: [],
        perAnswerFeedback: [],
        topPriorities: ['Practice regularly', 'Use connectives', 'Maintain pace'],
        sessionMetrics: {
          totalAnswers: 2,
          totalWords: 35,
          totalDurationSeconds: 20,
          overallWpm: 105,
          totalPauses: 4,
          totalLongPauses: 1,
          averagePauseDurationMs: 500,
          totalFillers: 2,
          topFillers: [{ word: 'um', count: 2 }],
          averageLexicalDiversity: 0.8,
          totalLinkers: 2,
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
          transcript: 'I currently work as a graphic designer for a local advertising studio in town.',
          durationSec: 10,
          wpm: 105
        },
        {
          questionId: 'q2',
          part: 'part1',
          questionText: 'Do you enjoy it?',
          transcript: 'Yes, because it allows me to express my artistic creativity every single day.',
          durationSec: 10,
          wpm: 105
        }
      ]
    };

    renderIeltsResultView(container, offlineRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    // Overall band must be "—"
    expect(container.querySelector('#result-overall-band')?.textContent?.trim()).toBe('—');

    // Must be clearly labeled "no band score without AI evaluation"
    expect(container.innerHTML).toContain('An AI evaluator was not available for this attempt');

    // Must show objective stats: WPM, pauses, fillers, word count, answer count
    expect(container.querySelector('#stat-wpm')?.textContent?.trim()).toBe('105');
    expect(container.querySelector('#stat-pauses')?.textContent?.trim()).toBe('4');
    expect(container.querySelector('#stat-fillers')?.textContent?.trim()).toBe('2');
    expect(container.querySelector('#stat-words')?.textContent?.trim()).toBe('35');
    expect(container.querySelector('#stat-answers')?.textContent?.trim()).toBe('2');
  });

  it('renders short-answer notice when candidate gave very short answers and gives no score', () => {
    const shortRecord: IeltsTestRecord = {
      id: 'test_rec_short',
      timestamp: 1773000000000,
      mode: 'part1',
      overallBand: null,
      evaluation: {
        overallBand: null,
        pronunciationNotice: 'Answers were too short for evaluation.',
        perCriterionComments: { fluency: '', lexical: '', grammar: '', pronunciation: '' },
        corrections: [],
        vocabularyUpgrades: [],
        modelAnswers: [],
        perAnswerFeedback: [],
        topPriorities: ['Elaborate on answers', 'Speak longer', 'Give examples'],
        sessionMetrics: {
          totalAnswers: 1,
          totalWords: 3,
          totalDurationSeconds: 2,
          overallWpm: 45,
          totalPauses: 0,
          totalLongPauses: 0,
          averagePauseDurationMs: 0,
          totalFillers: 0,
          topFillers: [],
          averageLexicalDiversity: 1.0,
          totalLinkers: 0,
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
        noScoreNotice: 'Candidate gave very short answers (3 words total). Insufficient speech to evaluate; no scores produced.'
      },
      answers: [
        {
          questionId: 'q1',
          part: 'part1',
          questionText: 'Do you work or study?',
          transcript: 'I just study.',
          durationSec: 2,
          wpm: 45
        }
      ]
    };

    renderIeltsResultView(container, shortRecord, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    expect(container.querySelector('#result-overall-band')?.textContent?.trim()).toBe('—');
    expect(container.innerHTML).toContain('Candidate gave very short answers');
    expect(container.innerHTML).toContain('No band score this time');
  });

  it('renders "Not assessed" for pronunciation when pronunciationBand is null (A1-3)', () => {
    const recordWithoutPronConfidence: IeltsTestRecord = {
      ...mockTestRecord,
      id: 'test_rec_no_pron',
      overallBand: 7.5,
      evaluation: {
        ...mockTestRecord.evaluation!,
        overallBand: 7.5,
        pronunciationBand: null,
        pronunciationNotice: 'Not assessed (no acoustic confidence data returned by speech recognition)',
        perCriterionComments: {
          ...mockTestRecord.evaluation!.perCriterionComments,
          pronunciation: 'Not assessed — speech recognition did not provide acoustic confidence scores.'
        }
      }
    };

    renderIeltsResultView(container, recordWithoutPronConfidence, {
      onRetake: vi.fn(),
      onBackToHistory: vi.fn()
    });

    expect(container.querySelector('#result-overall-band')?.textContent?.trim()).toBe('7.5');
    expect(container.querySelector('#result-pronunciation-band')?.textContent?.trim()).toBe(
      'Not assessed'
    );
    expect(container.querySelector('#result-pronunciation-desc')?.textContent).toContain(
      'Not assessed'
    );
  });
});
