import { Preferences } from '@capacitor/preferences';
import {
  loadShadowingSetHistory,
  makeSeedHistory,
  type ShadowingSetHistory
} from './shadowingSetHistory';
import {
  DEFAULT_SHADOWING_LANGUAGE,
  SHADOWING_LANGUAGES,
  type ShadowingLanguageCode
} from '../data/shadowingLanguages';

/**
 * Stores one independent sentence history per practice language.
 * The existing v2 history remains the migration source for English, so
 * existing sentence sets and the active position are retained unchanged.
 */
export type ShadowingLanguageHistories = Partial<Record<ShadowingLanguageCode, ShadowingSetHistory>>;

export const SHADOWING_LANGUAGE_HISTORY_KEY = 'speakcoach_shadowing_language_history_v1';

function isDifficultyHistory(value: unknown): boolean {
  const entry = value as {
    sets?: unknown[];
    activeSetId?: unknown;
    activeSentenceIndex?: unknown;
  } | null;
  if (!entry || !Array.isArray(entry.sets) || typeof entry.activeSetId !== 'string') return false;
  if (!Number.isInteger(entry.activeSentenceIndex) || Number(entry.activeSentenceIndex) < 0) return false;
  if (entry.sets.length === 0) return entry.activeSetId === '' && entry.activeSentenceIndex === 0;
  const activeSet = entry.sets.find(set => (set as { id?: unknown } | null)?.id === entry.activeSetId) as
    { sentences?: unknown[] } | undefined;
  return !!activeSet && Array.isArray(activeSet.sentences) &&
    Number(entry.activeSentenceIndex) < activeSet.sentences.length &&
    entry.sets.every(set => {
      const item = set as { id?: unknown; source?: unknown; sentences?: unknown[] } | null;
      return !!item && typeof item.id === 'string' &&
        (item.source === 'builtin' || item.source === 'ai') &&
        Array.isArray(item.sentences) && item.sentences.length >= 1 && item.sentences.length <= 20 &&
        (item.source !== 'ai' || item.sentences.length === 20) &&
        item.sentences.every(sentence => {
          const row = sentence as Record<string, unknown> | null;
          return !!row && typeof row.id === 'string' && typeof row.text === 'string' &&
            typeof row.topic === 'string' && typeof row.phoneticFocus === 'string' &&
            typeof row.expectedTotalDurationMs === 'number';
        });
    });
}

function isLanguageHistories(value: unknown): value is ShadowingLanguageHistories {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!record[DEFAULT_SHADOWING_LANGUAGE]) return false;
  return Object.entries(record).every(([code, history]) =>
    SHADOWING_LANGUAGES.some(language => language.code === code) &&
    !!history && typeof history === 'object' &&
    ['easy', 'medium', 'hard'].every(difficulty =>
      isDifficultyHistory((history as Record<string, unknown>)[difficulty])
    ) && ((history as Record<string, unknown>).ielts === undefined ||
      isDifficultyHistory((history as Record<string, unknown>).ielts))
  );
}

export async function loadShadowingLanguageHistories(): Promise<ShadowingLanguageHistories> {
  try {
    const stored = await Preferences.get({ key: SHADOWING_LANGUAGE_HISTORY_KEY });
    if (stored.value) {
      const parsed: unknown = JSON.parse(stored.value);
      if (isLanguageHistories(parsed)) {
        const upgraded = { ...(parsed as ShadowingLanguageHistories) };
        for (const history of Object.values(upgraded)) {
          if (history && !history.ielts) history.ielts = { sets: [], activeSetId: '', activeSentenceIndex: 0 };
        }
        if (JSON.stringify(upgraded) !== JSON.stringify(parsed)) await saveShadowingLanguageHistories(upgraded);
        return upgraded;
      }
    }
  } catch (error) {
    console.warn('[SpeakCoach] Could not load language-specific Shadowing history; attempting migration.', error);
  }

  // Migration path: the pre-multilingual history is always English.
  // Do not copy English sentences into other languages.
  const englishHistory = await loadShadowingSetHistory();
  const migrated: ShadowingLanguageHistories = {
    [DEFAULT_SHADOWING_LANGUAGE]: englishHistory
  };
  await saveShadowingLanguageHistories(migrated);
  return migrated;
}

export async function saveShadowingLanguageHistories(
  histories: ShadowingLanguageHistories
): Promise<void> {
  await Preferences.set({
    key: SHADOWING_LANGUAGE_HISTORY_KEY,
    value: JSON.stringify(histories)
  });
}

export function getShadowingHistoryForLanguage(
  histories: ShadowingLanguageHistories,
  languageCode: ShadowingLanguageCode
): ShadowingSetHistory | null {
  return histories[languageCode] ?? null;
}

export function setShadowingHistoryForLanguage(
  histories: ShadowingLanguageHistories,
  languageCode: ShadowingLanguageCode,
  history: ShadowingSetHistory
): ShadowingLanguageHistories {
  return { ...histories, [languageCode]: history };
}

export const SHADOWING_SELECTED_LANGUAGE_KEY = 'speakcoach_shadowing_selected_language_v1';

export async function loadSelectedShadowingLanguage(): Promise<ShadowingLanguageCode> {
  try {
    const stored = await Preferences.get({ key: SHADOWING_SELECTED_LANGUAGE_KEY });
    const code = stored.value;
    return SHADOWING_LANGUAGES.some(language => language.code === code)
      ? code as ShadowingLanguageCode
      : DEFAULT_SHADOWING_LANGUAGE;
  } catch { return DEFAULT_SHADOWING_LANGUAGE; }
}

export async function saveSelectedShadowingLanguage(code: ShadowingLanguageCode): Promise<void> {
  await Preferences.set({ key: SHADOWING_SELECTED_LANGUAGE_KEY, value: code });
}

/** Creates a native offline starter history for a language not used before. */
export function createShadowingHistoryForLanguage(languageCode: ShadowingLanguageCode): ShadowingSetHistory {
  return makeSeedHistory(languageCode);
}
