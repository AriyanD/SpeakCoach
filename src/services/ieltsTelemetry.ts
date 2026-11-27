import { Preferences } from '@capacitor/preferences';
import type { IeltsTestRecord } from '../storage/ieltsHistoryStore';

const LAST_IELTS_KEY = 'speakcoach.ielts.last_evaluation.v1';
const SESSION_LOG_KEY = 'speakcoach.ielts.session_log.v1';

export interface IeltsSessionLogEntry {
  timestamp: string;
  event: string;
  status: string;
  stepIndex?: number;
  questionId?: string;
  error?: string;
  details?: string;
}

let inMemoryLastRecord: IeltsTestRecord | null = null;
let inMemorySessionLogs: IeltsSessionLogEntry[] = [];

function sanitizeSessionLogEntry(entry: IeltsSessionLogEntry): IeltsSessionLogEntry {
  if (entry.event === 'recognizer_result') {
    const details = entry.details ?? '';
    const legacyTranscript = details.match(/^Raw system-recognizer transcript: "([\s\S]*)" \| confidence:/i)?.[1];
    const transcriptLength = details.match(/transcriptLength=(\d+)/i)?.[1] ??
      (legacyTranscript !== undefined ? String(legacyTranscript.length) : 'unknown');
    const confidence = details.match(/confidence[=:]\s*([^|;]+)/i)?.[1]?.trim() ?? 'N/A';
    const duration = details.match(/duration[=:]\s*(\d+)s?/i)?.[1] ?? 'unknown';
    return {
      ...entry,
      details: `System recognizer completed; transcript omitted; characters=${transcriptLength}; confidence=${confidence}; duration=${duration}s`
    };
  }
  if (entry.event === 'whisper_recovered_transcript') {
    return {
      ...entry,
      details: 'Recovered transcript via Tier 2 STT; transcript omitted from technical logs.'
    };
  }
  if (entry.event === 'LLM Evaluation') {
    const provider = entry.details?.match(/^Provider: ([^;|]{1,80})/i)?.[1]?.trim();
    const httpStatus = entry.details?.match(/\bHTTP (\d{3})\b/i)?.[1] ??
      entry.error?.match(/\bHTTP (\d{3})\b/i)?.[1];
    return {
      ...entry,
      error: httpStatus
        ? `LLM evaluation failed (HTTP ${httpStatus}); provider response omitted.`
        : 'LLM evaluation failed; provider response omitted.',
      details: [
        provider ? `Provider: ${provider}` : 'Provider: unavailable',
        httpStatus ? `HTTP ${httpStatus}` : 'Failure stage: evaluation',
        'response omitted from technical logs'
      ].join('; ')
    };
  }
  return entry;
}

export function logIeltsSessionEvent(
  entry: Omit<IeltsSessionLogEntry, 'timestamp'>
): void {
  const fullEntry = sanitizeSessionLogEntry({
    ...entry,
    timestamp: new Date().toISOString()
  });
  inMemorySessionLogs.push(fullEntry);
  if (inMemorySessionLogs.length > 100) {
    inMemorySessionLogs.shift();
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(inMemorySessionLogs));
    }
  } catch {
    // Ignore storage errors in logging
  }
}

export function getIeltsSessionLogs(): IeltsSessionLogEntry[] {
  if (inMemorySessionLogs.length > 0) {
    return inMemorySessionLogs;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SESSION_LOG_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          inMemorySessionLogs = parsed.map((item) =>
            sanitizeSessionLogEntry(item as IeltsSessionLogEntry)
          );
          if (JSON.stringify(inMemorySessionLogs) !== JSON.stringify(parsed)) {
            try {
              localStorage.setItem(SESSION_LOG_KEY, JSON.stringify(inMemorySessionLogs));
            } catch {
              // Keep sanitized entries in memory if storage is temporarily unavailable.
            }
          }
          return inMemorySessionLogs;
        }
      }
    }
  } catch {
    // Fallback
  }
  return [];
}

export function clearIeltsSessionLogs(): void {
  inMemorySessionLogs = [];
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SESSION_LOG_KEY);
    }
  } catch {
    // Fallback
  }
}

export async function recordLastIeltsEvaluation(record: IeltsTestRecord): Promise<void> {
  inMemoryLastRecord = record;
  try {
    await Preferences.set({ key: LAST_IELTS_KEY, value: JSON.stringify(record) });
  } catch {
    // Fallback to localStorage in web/test environment
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LAST_IELTS_KEY, JSON.stringify(record));
  }
}

export async function getLastIeltsEvaluation(): Promise<IeltsTestRecord | null> {
  if (inMemoryLastRecord) return inMemoryLastRecord;

  try {
    const res = await Preferences.get({ key: LAST_IELTS_KEY });
    if (res && res.value) {
      inMemoryLastRecord = JSON.parse(res.value);
      return inMemoryLastRecord;
    }
  } catch {
    // Fallback
  }

  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LAST_IELTS_KEY);
    if (raw) {
      try {
        inMemoryLastRecord = JSON.parse(raw);
        return inMemoryLastRecord;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function clearLastIeltsEvaluation(): Promise<void> {
  inMemoryLastRecord = null;
  // Preferences is the primary store on Android; clear both stores so stale
  // evaluation data cannot reappear after the browser fallback is cleared.
  await Preferences.remove({ key: LAST_IELTS_KEY });
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LAST_IELTS_KEY);
  } catch {
    // Preferences remains the source of truth on Android.
  }
}

export async function clearIeltsTelemetry(): Promise<void> {
  clearIeltsSessionLogs();
  await clearLastIeltsEvaluation();
}
