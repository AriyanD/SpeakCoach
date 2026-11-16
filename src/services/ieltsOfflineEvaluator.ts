import type { ResolvedSlotTier } from '../config/types';
import type { SpokenWordToken } from './wordAlignment';
import type { IeltsAnswerMetrics, IeltsSessionMetricsSummary } from './ieltsSpeechMetrics';

export interface IeltsAnswerInput {
  questionId: string;
  part: 1 | 2 | 3;
  question: string;
  transcript: string;
  durationMs: number;
  tokens?: SpokenWordToken[];
  confidence?: number;
  wasSkipped?: boolean;
}

export interface IeltsGrammarCorrection {
  original: string;
  corrected: string;
  explanation: string;
}

export interface IeltsVocabularyUpgrade {
  original: string;
  upgraded: string;
  context: string;
}

export interface IeltsPerAnswerFeedback {
  questionId: string;
  question: string;
  transcript: string;
  bandEstimate: number | null;
  comment: string;
}

export interface IeltsModelAnswer {
  question: string;
  band7ModelAnswer: string;
}

export interface IeltsEvaluationResult {
  overallBand: number | null; // 0-9 in 0.5 steps for online AI, or null when no AI evaluation
  fluencyCoherenceBand?: number | null;
  lexicalResourceBand?: number | null;
  grammaticalRangeBand?: number | null;
  pronunciationBand?: number | null;
  pronunciationNotice: string;
  perCriterionComments: {
    fluency: string;
    lexical: string;
    grammar: string;
    pronunciation: string;
  };
  corrections: IeltsGrammarCorrection[];
  vocabularyUpgrades: IeltsVocabularyUpgrade[];
  modelAnswers: IeltsModelAnswer[];
  perAnswerFeedback: IeltsPerAnswerFeedback[];
  topPriorities: [string, string, string];
  sessionMetrics: IeltsSessionMetricsSummary;
  answerMetrics: IeltsAnswerMetrics[];
  activeTier: ResolvedSlotTier;
  confidenceLabel: string;
  fallbackReason?: string;
  noScoreNotice?: string;
}

export function roundToIeltsBand(score: number): number {
  const clamped = Math.max(0, Math.min(9, score));
  const fraction = clamped - Math.floor(clamped);
  if (fraction < 0.25) return Math.floor(clamped);
  if (fraction < 0.75) return Math.floor(clamped) + 0.5;
  return Math.ceil(clamped);
}

