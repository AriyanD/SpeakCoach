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

export function logIeltsSessionEvent(
  entry: Omit<IeltsSessionLogEntry, 'timestamp'>
): void {
  const fullEntry: IeltsSessionLogEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  };
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
        inMemorySessionLogs = JSON.parse(raw);
        return inMemorySessionLogs;
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

export async function clearIeltsTelemetry(): Promise<void> {
  inMemoryLastRecord = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(LAST_IELTS_KEY);
  }
  // Preferences is the primary store on Android; removing only the browser
  // copy lets the supposedly cleared record reappear on the next read.
  await Preferences.remove({ key: LAST_IELTS_KEY });
}
