import { Preferences } from '@capacitor/preferences';
import type { IeltsEvaluationResult } from '../services/ieltsOfflineEvaluator';
import type { IeltsTestSessionPlan } from '../data/ieltsQuestionTypes';
import type { IeltsTestMode } from '../services/ieltsSessionEngine';
import type { IeltsAnswerInput } from '../services/ieltsLlmEvaluator';

export interface IeltsAnswerSummary {
  questionId: string;
  part: 'part1' | 'part2' | 'part3';
  questionText: string;
  transcript: string;
  durationSec: number;
  wpm?: number;
  wasSkipped?: boolean;
}

export interface IeltsAttemptComparison {
  summary: string;
  overallBandPrevious: number | null;
  overallBandCurrent: number | null;
  overallBandChange: number | null;
  criteria: {
    fluencyCoherence: { previous: number | null; current: number | null; change: number | null; analysis: string };
    lexicalResource: { previous: number | null; current: number | null; change: number | null; analysis: string };
    grammar: { previous: number | null; current: number | null; change: number | null; analysis: string };
    pronunciation: { previous: number | null; current: number | null; change: number | null; analysis: string };
  };
  answerComparisons: Array<{ question: string; previousAnswer: string; currentAnswer: string; analysis: string }>;
  strengths: string[];
  priorities: string[];
}

export interface IeltsEvaluationHistoryEntry {
  id: string;
  evaluatedAt: number;
  mode: 'api' | 'offline';
  providerChoice: 'auto' | 'primary' | 'secondary';
  providerId?: string;
  providerName?: string;
  result: IeltsEvaluationResult;
}

export interface IeltsTestRecord {
  id: string;
  timestamp: number;
  mode: 'full' | 'part1' | 'part2' | 'part3';
  overallBand: number | null;
  evaluation?: IeltsEvaluationResult | null;
  /** Previous and current evaluation runs; optional for backward-compatible backups. */
  evaluationHistory?: IeltsEvaluationHistoryEntry[];
  evaluationError?: string | null;
  answers: IeltsAnswerSummary[];
  questionSource?: 'AI' | 'OFFLINE';
  questionSourceDetails?: {
    providerName?: string;
    modelName?: string;
    totalQuestions?: number;
    fallbackReason?: string;
  };
  /** Exact question plan required to repeat this attempt. */
  plan?: IeltsTestSessionPlan;
  /** Stable lineage key shared by all attempts using the same question set. */
  questionSetId?: string;
  attemptNumber?: number;
  previousAttemptId?: string;
  comparison?: IeltsAttemptComparison;
  comparisonError?: string | null;
}

export interface IeltsSessionDraft {
  sessionId?: string;
  mode: IeltsTestMode;
  plan: IeltsTestSessionPlan;
  currentStepIndex: number;
  candidateNotes: string;
  completedAnswers: IeltsAnswerInput[];
  updatedAt: number;
  questionSource?: 'AI' | 'OFFLINE';
  questionSourceDetails?: {
    providerName?: string;
    modelName?: string;
    totalQuestions?: number;
    fallbackReason?: string;
  };
}

const HISTORY_KEY = 'speakcoach_ielts_history_v1';
const DRAFT_KEY = 'speakcoach_ielts_draft_v1';
const RECOVERY_PREFIX = 'speakcoach.ielts_history_recovery.v1.';
const historyRecoveryNotices: string[] = [];
const preservedCorruptHistory = new Set<string>();

export function getIeltsHistoryRecoveryNotices(): string[] {
  return [...historyRecoveryNotices];
}

async function preserveCorruptHistoryRaw(key: string, raw: string): Promise<void> {
  const signature = `${key}\\u0000${raw}`;
  if (preservedCorruptHistory.has(signature)) return;
  preservedCorruptHistory.add(signature);
  const recoveryKey = `${RECOVERY_PREFIX}${key}.${Date.now()}`;
  let preserved = false;
  try {
    await Preferences.set({ key: recoveryKey, value: raw });
    preserved = true;
  } catch { /* Try WebView storage below. */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(recoveryKey, raw);
      preserved = true;
    }
  } catch { /* Preserve a visible warning if both stores are unavailable. */ }
  historyRecoveryNotices.push(
    preserved
      ? `Unreadable IELTS history data was preserved as "${recoveryKey}".`
      : 'Unreadable IELTS history data could not be copied to a recovery file. Do not clear app data; export any remaining data immediately.'
  );
}

function isValidHistoryRecord(value: unknown): value is IeltsTestRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<IeltsTestRecord>;
  return typeof record.id === 'string' &&
    typeof record.timestamp === 'number' &&
    ['full', 'part1', 'part2', 'part3'].includes(record.mode ?? '') &&
    Array.isArray(record.answers);
}

function isValidSessionDraft(value: unknown): value is IeltsSessionDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<IeltsSessionDraft>;
  return Boolean(draft.plan) &&
    ['full', 'part1', 'part2', 'part3'].includes(draft.mode ?? '') &&
    typeof draft.currentStepIndex === 'number' &&
    Array.isArray(draft.completedAnswers);
}

async function getStorageItem(key: string): Promise<string | null> {
  try {
    const res = await Preferences.get({ key });
    if (res && res.value !== null && res.value !== undefined) {
      return res.value;
    }
  } catch {
    // Ignore and fallback
  }

  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return null;
}

async function setStorageItem(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
  } catch {
    // Ignore and fallback
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

async function removeStorageItem(key: string): Promise<void> {
  try {
    await Preferences.remove({ key });
  } catch {
    // Ignore and fallback
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  }
}

let hasRunDeduplication = false;

/**
 * Deduplicates test records:
 * 1. Removes records with identical IDs.
 * 2. Removes records that share identical test content (mode, overallBand, question count, and answer text)
 *    within a close timestamp window (<= 10 minutes) caused by rapid re-renders.
 */
export function deduplicateTestRecords(records: IeltsTestRecord[]): IeltsTestRecord[] {
  const result: IeltsTestRecord[] = [];
  const seenIds = new Set<string>();

  for (const rec of records) {
    if (!rec || !rec.id) continue;
    if (seenIds.has(rec.id)) continue;

    // Check if this matches an already accepted record with identical session content within 10 minutes
    const isDuplicate = result.some((existing) => {
      // Repeated attempts of the same saved question set are intentional records, never duplicates.
      if (existing.questionSetId && rec.questionSetId && existing.questionSetId === rec.questionSetId && existing.id !== rec.id) return false;
      if (existing.mode !== rec.mode) return false;
      if (existing.overallBand !== rec.overallBand) {
        if (existing.overallBand === null || rec.overallBand === null) return false;
        if (Math.abs(existing.overallBand - rec.overallBand) > 0.01) return false;
      }
      const timeDiff = Math.abs(existing.timestamp - rec.timestamp);
      if (timeDiff > 10 * 60 * 1000) return false;

      // Compare answers signature
      const existingAns = existing.answers || [];
      const recAns = rec.answers || [];
      if (existingAns.length !== recAns.length) return false;

      if (existingAns.length === 0 && recAns.length === 0) return true;

      // Check first and last answer question and text
      const firstMatches =
        existingAns[0]?.questionId === recAns[0]?.questionId &&
        existingAns[0]?.transcript === recAns[0]?.transcript;
      const lastIdx = existingAns.length - 1;
      const lastMatches =
        existingAns[lastIdx]?.questionId === recAns[lastIdx]?.questionId &&
        existingAns[lastIdx]?.transcript === recAns[lastIdx]?.transcript;

      return firstMatches && lastMatches;
    });

    if (!isDuplicate) {
      seenIds.add(rec.id);
      result.push(rec);
    }
  }

  return result;
}

/**
 * Manually runs deduplication cleanup on the stored history.
 */
export async function deduplicateIeltsHistory(): Promise<number> {
  const raw = await getStorageItem(HISTORY_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
      return 0;
    }
    const records = parsed.filter(isValidHistoryRecord);
    if (records.length !== parsed.length) await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
    const deduped = deduplicateTestRecords(records);
    const removedCount = records.length - deduped.length;
    if (removedCount > 0) {
      await setStorageItem(HISTORY_KEY, JSON.stringify(deduped));
    }
    return removedCount;
  } catch {
    await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
    return 0;
  }
}

/**
 * Saves a completed IELTS test evaluation result to history.
 * Idempotently updates if a record with the same ID already exists.
 */
export async function saveIeltsTestResult(
  data: Omit<IeltsTestRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
): Promise<IeltsTestRecord> {
  const recordId = data.id || `ielts_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const recordTimestamp = data.timestamp || Date.now();

  const record: IeltsTestRecord = {
    id: recordId,
    timestamp: recordTimestamp,
    mode: data.mode,
    overallBand: data.overallBand,
    evaluation: data.evaluation ?? null,
    evaluationHistory: data.evaluationHistory,
    evaluationError: data.evaluationError ?? null,
    answers: data.answers,
    questionSource: data.questionSource,
    questionSourceDetails: data.questionSourceDetails,
    plan: data.plan,
    questionSetId: data.questionSetId ?? data.plan?.id,
    comparison: data.comparison,
    comparisonError: data.comparisonError ?? null
  };

  const history = await getIeltsTestHistory();
  const existingIndex = history.findIndex((r) => r.id === recordId);
  if (record.evaluationHistory === undefined && existingIndex >= 0) {
    record.evaluationHistory = history[existingIndex].evaluationHistory;
  }
  const lineage = record.questionSetId;
  const previousAttempts = lineage ? history.filter(r => r.questionSetId === lineage && r.id !== recordId).sort((a, b) => a.timestamp - b.timestamp) : [];
  if (existingIndex < 0 && lineage) {
    record.attemptNumber = previousAttempts.length + 1;
    record.previousAttemptId = previousAttempts[previousAttempts.length - 1]?.id;
  } else if (existingIndex >= 0) {
    record.attemptNumber = history[existingIndex].attemptNumber;
    record.previousAttemptId = history[existingIndex].previousAttemptId;
  }

  if (existingIndex >= 0) {
    // Idempotent upsert: update existing entry
    history[existingIndex] = record;
  } else {
    // Insert newest first
    history.unshift(record);
  }

  // Deduplicate in case of duplicate content
  const deduped = deduplicateTestRecords(history);

  // Keep up to 50 historical tests
  const trimmed = deduped.slice(0, 50);
  await setStorageItem(HISTORY_KEY, JSON.stringify(trimmed));

  // If a draft exists, clear it upon successful completion
  await clearIeltsDraft();

  return record;
}

/**
 * Retrieves all saved IELTS test records (ordered newest first).
 * Automatically cleans up existing duplicates on first run.
 */
export async function getIeltsTestHistory(): Promise<IeltsTestRecord[]> {
  const raw = await getStorageItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
      return [];
    }
    const validRecords = parsed.filter(isValidHistoryRecord);
    if (validRecords.length !== parsed.length) {
      await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
    }
    if (!hasRunDeduplication) {
      hasRunDeduplication = true;
      const deduped = deduplicateTestRecords(validRecords);
      if (deduped.length !== validRecords.length) {
        await setStorageItem(HISTORY_KEY, JSON.stringify(deduped));
        return deduped;
      }
    }
    return validRecords;
  } catch {
    await preserveCorruptHistoryRaw(HISTORY_KEY, raw);
    return [];
  }
}

/**
 * Retrieves a single IELTS test record by ID.
 */
export async function getIeltsTestResult(id: string): Promise<IeltsTestRecord | null> {
  const history = await getIeltsTestHistory();
  return history.find((r) => r.id === id) || null;
}

/**
 * Deletes a single IELTS test record by ID.
 */
export async function deleteIeltsTestResult(id: string): Promise<void> {
  const history = await getIeltsTestHistory();
  const filtered = history.filter((r) => r.id !== id);
  await setStorageItem(HISTORY_KEY, JSON.stringify(filtered));
}

/**
 * Clears all IELTS test history.
 */
export async function clearIeltsTestHistory(): Promise<void> {
  await removeStorageItem(HISTORY_KEY);
}

/**
 * Saves an in-progress session draft for interruption recovery.
 */
export async function saveIeltsDraft(draft: IeltsSessionDraft): Promise<void> {
  await setStorageItem(DRAFT_KEY, JSON.stringify(draft));
}

/**
 * Loads the active in-progress session draft if one exists.
 */
export async function loadIeltsDraft(): Promise<IeltsSessionDraft | null> {
  const raw = await getStorageItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (isValidSessionDraft(parsed)) return parsed;
    await preserveCorruptHistoryRaw(DRAFT_KEY, raw);
    return null;
  } catch {
    await preserveCorruptHistoryRaw(DRAFT_KEY, raw);
    return null;
  }
}

/**
 * Clears the active session draft.
 */
export async function clearIeltsDraft(): Promise<void> {
  await removeStorageItem(DRAFT_KEY);
}


/** Export and restore IELTS records plus an in-progress draft as one portable test-data snapshot. */
export async function exportIeltsHistorySnapshot(): Promise<{ history: IeltsTestRecord[]; draft: IeltsSessionDraft | null }> {
  return { history: await getIeltsTestHistory(), draft: await loadIeltsDraft() };
}

export async function importIeltsHistorySnapshot(snapshot: {
  history?: IeltsTestRecord[];
  draft?: IeltsSessionDraft | null;
}): Promise<void> {
  if (!snapshot || (snapshot.history !== undefined && !Array.isArray(snapshot.history))) {
    throw new Error('The test-data backup has an invalid IELTS history section.');
  }
  if (Array.isArray(snapshot.history)) {
    const valid = snapshot.history.filter((record) =>
      record && typeof record.id === 'string' && typeof record.timestamp === 'number' &&
      Array.isArray(record.answers) && ['full', 'part1', 'part2', 'part3'].includes(record.mode)
    );
    await setStorageItem(HISTORY_KEY, JSON.stringify(deduplicateTestRecords(valid).slice(0, 500)));
  }
  if (snapshot.draft === null) {
    await removeStorageItem(DRAFT_KEY);
  } else if (snapshot.draft && snapshot.draft.plan && snapshot.draft.mode) {
    await setStorageItem(DRAFT_KEY, JSON.stringify(snapshot.draft));
  }
}
