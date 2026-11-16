import { Preferences } from '@capacitor/preferences';
import type { RecognizerAlternative } from './audioRecorder';
import type { ShadowingScoreReport } from './shadowingScorer';
import type { AlignedWordResult, SpokenWordToken } from './wordAlignment';

const LAST_ATTEMPT_KEY = 'speakcoach.shadowing.last_attempt.v1';

export interface LastShadowingAttempt {
  timestamp: string;
  referenceText: string;
  rawRecognizerText: string;
  recognizerConfidence: number;
  recognizerAlternatives: RecognizerAlternative[];
  recognizerError?: string;
  sttWordTimestamps?: SpokenWordToken[];
  sttActiveTierLabel?: string;
  words: AlignedWordResult[];
  overallScore: number;
  pronunciationScore: number;
  fluencyScore: number;
  completenessScore: number;
  wasEmptyRecognition: boolean;
}

let inMemoryLastAttempt: LastShadowingAttempt | null = null;

export async function recordLastShadowingAttempt(params: {
  referenceText: string;
  rawRecognizerText: string;
  recognizerConfidence: number;
  recognizerAlternatives: RecognizerAlternative[];
  recognizerError?: string;
  sttWordTimestamps?: SpokenWordToken[];
  sttActiveTierLabel?: string;
  report: ShadowingScoreReport | null;
}): Promise<LastShadowingAttempt> {
  const cleanRaw = params.rawRecognizerText.trim();
  const attempt: LastShadowingAttempt = {
    timestamp: new Date().toISOString(),
    referenceText: params.referenceText,
    rawRecognizerText: cleanRaw,
    recognizerConfidence: params.recognizerConfidence,
    recognizerAlternatives: params.recognizerAlternatives,
    recognizerError: params.recognizerError,
    sttWordTimestamps: params.sttWordTimestamps ?? [],
    sttActiveTierLabel: params.sttActiveTierLabel,
    words: params.report?.words ?? [],
    overallScore: params.report?.overallScore ?? 0,
    pronunciationScore: params.report?.pronunciationScore ?? 0,
    fluencyScore: params.report?.fluencyScore ?? 0,
    completenessScore: params.report?.completenessScore ?? 0,
    wasEmptyRecognition: cleanRaw.length === 0
  };

  inMemoryLastAttempt = attempt;
  const serialized = JSON.stringify(attempt);
  try {
    await Preferences.set({ key: LAST_ATTEMPT_KEY, value: serialized });
  } catch {
    // Ignore native bridge error in headless tests
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LAST_ATTEMPT_KEY, serialized);
  }
  return attempt;
}

export async function getLastShadowingAttempt(): Promise<LastShadowingAttempt | null> {
  if (inMemoryLastAttempt) return inMemoryLastAttempt;
  try {
    const res = await Preferences.get({ key: LAST_ATTEMPT_KEY });
    if (res?.value) {
      inMemoryLastAttempt = JSON.parse(res.value) as LastShadowingAttempt;
      return inMemoryLastAttempt;
    }
  } catch {
    // Ignore
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (raw) {
      try {
        inMemoryLastAttempt = JSON.parse(raw) as LastShadowingAttempt;
        return inMemoryLastAttempt;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function clearLastShadowingAttempt(): void {
  inMemoryLastAttempt = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LAST_ATTEMPT_KEY);
  }
}


/** Restores the most recent Shadowing attempt from a user-selected backup file. */
export async function restoreLastShadowingAttempt(attempt: LastShadowingAttempt | null): Promise<void> {
  inMemoryLastAttempt = attempt;
  if (attempt) {
    const serialized = JSON.stringify(attempt);
    try { await Preferences.set({ key: LAST_ATTEMPT_KEY, value: serialized }); } catch { /* local fallback below */ }
    if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_ATTEMPT_KEY, serialized);
  } else {
    try { await Preferences.remove({ key: LAST_ATTEMPT_KEY }); } catch { /* ignore */ }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LAST_ATTEMPT_KEY);
  }
}
