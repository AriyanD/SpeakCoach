import type { ResolvedSlotTier } from '../config/types';
import { getOfflinePreset } from '../config/providers';
import { buildReferenceWordTimings } from '../data/shadowingBank';
import { type WavVadAnalysisResult } from './wavVadAnalyzer';
import {
  alignSpokenWordsToReference,
  buildSpokenTokensFromTranscript,
  type AlignedWordResult,
  type SpokenWordToken
} from './wordAlignment';

export type OverallPaceLabel = 'too fast' | 'good' | 'too slow';

export function computeOverallPaceLabel(
  spokenDurationMs: number,
  expectedDurationMs: number
): OverallPaceLabel {
  const ratio = spokenDurationMs / Math.max(500, expectedDurationMs);
  if (ratio < 0.75) return 'too fast';
  if (ratio > 1.35) return 'too slow';
  return 'good';
}

export interface ShadowingScoreReport {
  referenceText: string;
  spokenTranscript: string;
  activeTier: ResolvedSlotTier;
  approximateNotice?: string;
  emptyRecognitionError?: string;
  overallScore: number; // 0-100
  pronunciationScore: number; // 0-100
  fluencyScore: number; // 0-100
  completenessScore: number; // 0-100
  paceScore: number; // 0-100
  overallPaceRatio: number; // spokenDurationMs / expectedDurationMs
  overallPaceLabel: OverallPaceLabel; // 'too fast' | 'good' | 'too slow'
  words: AlignedWordResult[];
  weakWords: string[];
  spokenDurationMs: number;
  expectedDurationMs: number;
  vadAnalysis?: WavVadAnalysisResult;
}

export function computeShadowingScoreFromAlignment(params: {
  referenceText: string;
  spokenTranscript: string;
  words: AlignedWordResult[];
  spokenDurationMs: number;
  expectedDurationMs: number;
  activeTier: ResolvedSlotTier;
  vadAnalysis?: WavVadAnalysisResult;
}): ShadowingScoreReport {
  const cleanSpoken = params.spokenTranscript.trim();

  // Hard guard: if recognizer returned empty/null, never score — return 0 across the board
  if (!cleanSpoken) {
    const refTimings = buildReferenceWordTimings(params.referenceText, params.expectedDurationMs);
    const missingWords: AlignedWordResult[] = refTimings.map((r) => ({
      referenceWord: r.word,
      status: 'missing',
      accuracyScore: 0,
      expectedStartMs: r.expectedStartMs,
      expectedDurationMs: r.expectedDurationMs
    }));
    return {
      referenceText: params.referenceText,
      spokenTranscript: '',
      activeTier: params.activeTier,
      emptyRecognitionError: 'Nothing was recognized, try again.',
      overallScore: 0,
      pronunciationScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      paceScore: 0,
      overallPaceRatio: 0,
      overallPaceLabel: 'good',
      words: missingWords,
      weakWords: refTimings.map((r) => r.word),
      spokenDurationMs: params.spokenDurationMs,
      expectedDurationMs: params.expectedDurationMs
    };
  }

  const refWords = params.words.filter((w) => w.status !== 'extra');
  const totalRefCount = Math.max(1, refWords.length);

  const matchedOrClose = refWords.filter(
    (w) => w.status === 'match' || w.status === 'mispronounced'
  );
  const exactMatched = refWords.filter((w) => w.status === 'match');
  const extraCount = params.words.filter((w) => w.status === 'extra').length;

  const overallPaceRatio = Number(
    (params.spokenDurationMs / Math.max(500, params.expectedDurationMs)).toFixed(2)
  );
  const overallPaceLabel = computeOverallPaceLabel(
    params.spokenDurationMs,
    params.expectedDurationMs
  );

  // If zero reference words matched or were even close (completely unrelated speech), score is near 0
  if (matchedOrClose.length === 0) {
    return {
      referenceText: params.referenceText,
      spokenTranscript: cleanSpoken,
      activeTier: params.activeTier,
      approximateNotice:
        params.activeTier.tier >= 2
          ? 'This score is based on speech-recognition text matching and timing, not phoneme-level pronunciation assessment. Tier 3 uses the Android system SpeechRecognizer; offline operation depends on the speech service installed on your device.'
          : undefined,
      overallScore: 0,
      pronunciationScore: 0,
      fluencyScore: 0,
      completenessScore: 0,
      paceScore: 0,
      overallPaceRatio,
      overallPaceLabel,
      words: params.words,
      weakWords: refWords.map((w) => w.referenceWord ?? '').filter((w) => w.length > 0),
      spokenDurationMs: params.spokenDurationMs,
      expectedDurationMs: params.expectedDurationMs
    };
  }

  // Completeness: % of reference words spoken
  const completenessScore = Math.round((matchedOrClose.length / totalRefCount) * 100);

  // Pronunciation: average word accuracy across reference words, penalized for extra insertions
  const sumWordAcc = refWords.reduce((acc, w) => acc + w.accuracyScore, 0);
  const rawPron = sumWordAcc / totalRefCount - extraCount * 5;
  const pronunciationScore = Math.max(0, Math.min(100, Math.round(rawPron)));

  // Fluency & Pace: compares total duration vs expected duration + word duration ratios & speed labels
  const pacePenalty = Math.min(45, Math.round(Math.abs(1 - overallPaceRatio) * 55));

  const validRatios = matchedOrClose
    .map((w) => w.relativeDurationRatio ?? w.durationRatio ?? 1)
    .filter((r) => r > 0);
  const avgRatioDeviation =
    validRatios.length > 0
      ? validRatios.reduce((acc, r) => acc + Math.abs(1 - r), 0) / validRatios.length
      : 1;
  const rhythmPenalty = Math.min(35, Math.round(avgRatioDeviation * 35));
  const missingFluencyPenalty = Math.round(
    ((totalRefCount - exactMatched.length) / totalRefCount) * 45
  );

  const rawFluency = Math.max(
    0,
    Math.min(100, 100 - pacePenalty - rhythmPenalty - missingFluencyPenalty)
  );
  const fluencyScore = Math.round(rawFluency * (matchedOrClose.length / totalRefCount));

  // Pace score: evaluates how many words are spoken in the 'OK' speed window vs too fast / too slow, scaled by completeness
  const wordsWithSpeed = refWords.filter((w) => w.speedLabel !== undefined);
  const okSpeedCount = wordsWithSpeed.filter((w) => w.speedLabel === 'OK').length;
  const wordPaceFactor =
    wordsWithSpeed.length > 0
      ? (okSpeedCount / wordsWithSpeed.length) * 100
      : Math.max(0, 100 - pacePenalty * 2);
  const rawPace = Math.max(
    0,
    Math.min(100, Math.round((100 - pacePenalty * 2) * 0.45 + wordPaceFactor * 0.55))
  );
  const paceScore = Math.round(rawPace * (matchedOrClose.length / totalRefCount));

  const overallScore = Math.round(
    pronunciationScore * 0.4 + completenessScore * 0.25 + fluencyScore * 0.2 + paceScore * 0.15
  );

  const weakWords = refWords
    .filter((w) => w.status === 'missing' || w.status === 'mispronounced')
    .map((w) => w.referenceWord ?? '')
    .filter((w) => w.length > 0);

  const approximateNotice =
    params.activeTier.tier >= 2
      ? 'This score is based on speech-recognition text matching and timing, not phoneme-level pronunciation assessment. Tier 3 uses the Android system SpeechRecognizer; offline operation depends on the speech service installed on your device.'
      : undefined;

  return {
    referenceText: params.referenceText,
    spokenTranscript: cleanSpoken,
    activeTier: params.activeTier,
    approximateNotice,
    overallScore,
    pronunciationScore,
    fluencyScore,
    completenessScore,
    paceScore,
    overallPaceRatio,
    overallPaceLabel,
    words: params.words,
    weakWords,
    spokenDurationMs: params.spokenDurationMs,
    expectedDurationMs: params.expectedDurationMs,
    vadAnalysis: params.vadAnalysis
  };
}

export function scoreShadowingOfflineTier3(params: {
  referenceText: string;
  spokenTranscript: string;
  spokenDurationMs: number;
  expectedDurationMs: number;
  confidence?: number;
  spokenTokensOverride?: SpokenWordToken[];
  activeTierOverride?: ResolvedSlotTier;
  vadAnalysis?: WavVadAnalysisResult;
  referenceTimingsOverride?: import('../data/shadowingBank').ReferenceWordTiming[];
  languageCode?: string;
}): ShadowingScoreReport {
  const offlinePreset = getOfflinePreset('pronunciation_scoring');
  const activeTier: ResolvedSlotTier = params.activeTierOverride ?? {
    slotId: 'pronunciation_scoring',
    providerId: offlinePreset.id,
    providerName: offlinePreset.name,
    tier: 3,
    label: 'Basic offline',
    detailLabel: `Basic offline (Tier 3 · ${offlinePreset.name})`,
    isFallback: false
  };

  const cleanTranscript = (params.spokenTranscript ?? '').trim();
  const validConf =
    typeof params.confidence === 'number' && params.confidence > 0 && params.confidence <= 1
      ? params.confidence
      : undefined;
  const tokens =
    params.spokenTokensOverride ??
    buildSpokenTokensFromTranscript(
      cleanTranscript,
      params.spokenDurationMs,
      validConf,
      params.languageCode ?? 'en'
    );

  const alignedWords = cleanTranscript
    ? alignSpokenWordsToReference(
        params.referenceText,
        tokens,
        params.expectedDurationMs,
        params.referenceTimingsOverride,
        params.languageCode ?? 'en'
      )
    : [];

  return computeShadowingScoreFromAlignment({
    referenceText: params.referenceText,
    spokenTranscript: cleanTranscript,
    words: alignedWords,
    spokenDurationMs: params.spokenDurationMs,
    expectedDurationMs: params.expectedDurationMs,
    activeTier,
    vadAnalysis: params.vadAnalysis
  });
}

export function scoreShadowingTier2(params: {
  referenceText: string;
  spokenTranscript: string;
  spokenTokens: SpokenWordToken[];
  spokenDurationMs: number;
  expectedDurationMs: number;
  activeTierOverride?: ResolvedSlotTier;
  vadAnalysis?: WavVadAnalysisResult;
  referenceTimingsOverride?: import('../data/shadowingBank').ReferenceWordTiming[];
  languageCode?: string;
}): ShadowingScoreReport {
  const activeTier: ResolvedSlotTier = params.activeTierOverride ?? {
    slotId: 'pronunciation_scoring',
    providerId: 'whisper_alignment',
    providerName: 'Whisper STT + Word Alignment (Tier 2)',
    tier: 2,
    label: 'Online AI',
    detailLabel: 'Online AI (Tier 2 · Whisper STT Alignment)',
    isFallback: false
  };

  const cleanTranscript = (params.spokenTranscript ?? '').trim();
  const alignedWords = cleanTranscript
    ? alignSpokenWordsToReference(
        params.referenceText,
        params.spokenTokens,
        params.expectedDurationMs,
        params.referenceTimingsOverride,
        params.languageCode ?? 'en'
      )
    : [];

  const report = computeShadowingScoreFromAlignment({
    referenceText: params.referenceText,
    spokenTranscript: cleanTranscript,
    words: alignedWords,
    spokenDurationMs: params.spokenDurationMs,
    expectedDurationMs: params.expectedDurationMs,
    activeTier,
    vadAnalysis: params.vadAnalysis
  });

  return {
    ...report,
    approximateNotice:
      'Online AI (Tier 2) aligns Whisper word timestamps to reference sentence for word timing, speed labels, and accuracy.'
  };
}
