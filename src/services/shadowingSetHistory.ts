import { Preferences } from '@capacitor/preferences';
import type { ShadowingDifficulty, ShadowingSentence } from '../data/shadowingBank';
import { getInitialShadowingSets } from '../data/shadowingSentenceSets';
import { getInitialMultilingualShadowingSets } from '../data/multilingualShadowingSentenceSets';
import type { ShadowingLanguageCode } from '../data/shadowingLanguages';

export interface ShadowingSentenceSet {
  id: string;
  source: 'builtin' | 'ai';
  createdAt: number;
  sentences: ShadowingSentence[];
}
export interface ShadowingDifficultyHistory {
  sets: ShadowingSentenceSet[];
  activeSetId: string;
  activeSentenceIndex: number;
}
export type ShadowingSetHistory = Record<ShadowingDifficulty, ShadowingDifficultyHistory>;

export const SHADOWING_HISTORY_KEY = 'speakcoach_shadowing_set_history_v2';
export const MAX_SHADOWING_SETS_PER_DIFFICULTY = 10;
const DIFFICULTIES: ShadowingDifficulty[] = ['easy', 'medium', 'hard', 'ielts'];

export function createEmptyShadowingSetHistory(): ShadowingSetHistory {
  return {
    easy: { sets: [], activeSetId: '', activeSentenceIndex: 0 },
    medium: { sets: [], activeSetId: '', activeSentenceIndex: 0 },
    hard: { sets: [], activeSetId: '', activeSentenceIndex: 0 },
    ielts: { sets: [], activeSetId: '', activeSentenceIndex: 0 }
  };
}

export function makeSeedHistory(languageCode: ShadowingLanguageCode = 'en'): ShadowingSetHistory {
  const history = {} as ShadowingSetHistory;
  for (const difficulty of DIFFICULTIES) {
    const initialSets = difficulty === 'ielts' ? [] : languageCode === 'en'
      ? getInitialShadowingSets(difficulty)
      : getInitialMultilingualShadowingSets(languageCode, difficulty);
    const sets = initialSets.map((sentences, index) => ({
      id: languageCode === 'en' ? `builtin-${difficulty}-${index + 1}` : `builtin-${languageCode}-${difficulty}-${index + 1}`,
      source: 'builtin' as const,
      createdAt: index,
      sentences
    }));
    history[difficulty] = { sets, activeSetId: sets[0]?.id ?? '', activeSentenceIndex: 0 };
  }
  return history;
}

function isSentence(value: unknown): value is ShadowingSentence {
  const item = value as ShadowingSentence | null;
  return !!item && typeof item.id === 'string' && typeof item.text === 'string' &&
    typeof item.topic === 'string' && typeof item.phoneticFocus === 'string' &&
    typeof item.expectedTotalDurationMs === 'number';
}

function isHistory(value: unknown): value is ShadowingSetHistory {
  if (!value || typeof value !== 'object') return false;
  return DIFFICULTIES.every(difficulty => {
    const entry = (value as ShadowingSetHistory)[difficulty];
    const activeSet = entry?.sets?.find(set => set.id === entry.activeSetId);
    return !!entry && Array.isArray(entry.sets) &&
      entry.sets.every(set => !!set && typeof set.id === 'string' &&
        (set.source === 'builtin' || set.source === 'ai') &&
        Array.isArray(set.sentences) &&
        set.sentences.length >= 1 && set.sentences.length <= 20 &&
        (set.source !== 'ai' || set.sentences.length === 20) &&
        set.sentences.every(isSentence)) &&
      (entry.sets.length === 0
        ? entry.activeSetId === '' && entry.activeSentenceIndex === 0
        : !!activeSet && Number.isInteger(entry.activeSentenceIndex) && entry.activeSentenceIndex >= 0 &&
          entry.activeSentenceIndex < activeSet.sentences.length);
  });
}

export async function loadShadowingSetHistory(): Promise<ShadowingSetHistory> {
  try {
    const { value } = await Preferences.get({ key: SHADOWING_HISTORY_KEY });
    if (value) {
      const parsed: unknown = JSON.parse(value);
      if (isHistory(parsed)) return parsed;
    }
  } catch (error) {
    console.warn('[SpeakCoach] Could not load Shadowing history; starting with offline sets.', error);
  }
  const seeded = makeSeedHistory();
  // Preserve the last AI batch created by the previous app version when upgrading.
  try {
    const legacy = JSON.parse(localStorage.getItem('speakcoach_shadowing_active_set_v1') || 'null') as unknown;
    if (Array.isArray(legacy) && legacy.length === 20 && legacy.every(isSentence)) {
      const difficulty = legacy[0].difficulty;
      if (DIFFICULTIES.includes(difficulty) && difficulty !== 'ielts' && legacy.every(sentence => sentence.difficulty === difficulty)) {
        const entry = seeded[difficulty];
        const migrated: ShadowingSentenceSet = {
          id: `migrated-ai-${Date.now()}`,
          source: 'ai',
          createdAt: Date.now(),
          sentences: legacy.map(sentence => ({ ...sentence }))
        };
        entry.sets.push(migrated);
        entry.activeSetId = migrated.id;
        entry.activeSentenceIndex = 0;
      }
    }
  } catch { /* Ignore malformed legacy data and retain the offline starter sets. */ }
  await saveShadowingSetHistory(seeded);
  try { localStorage.removeItem('speakcoach_shadowing_active_set_v1'); } catch { /* Preferences is the new source of truth. */ }
  return seeded;
}

export async function saveShadowingSetHistory(history: ShadowingSetHistory): Promise<void> {
  await Preferences.set({ key: SHADOWING_HISTORY_KEY, value: JSON.stringify(history) });
}

export function getActiveShadowingSet(history: ShadowingSetHistory, difficulty: ShadowingDifficulty): ShadowingSentenceSet {
  const entry = history[difficulty];
  return entry.sets.find(set => set.id === entry.activeSetId) ?? entry.sets[0];
}

export function selectShadowingSet(
  history: ShadowingSetHistory,
  difficulty: ShadowingDifficulty,
  setId: string,
  sentenceIndex = 0
): ShadowingSetHistory {
  const entry = history[difficulty];
  const selectedSet = entry.sets.find(set => set.id === setId);
  if (!selectedSet) return history;
  return {
    ...history,
    [difficulty]: {
      ...entry,
      activeSetId: setId,
      activeSentenceIndex: Math.max(0, Math.min(selectedSet.sentences.length - 1, sentenceIndex))
    }
  };
}

export function selectShadowingSentence(
  history: ShadowingSetHistory,
  difficulty: ShadowingDifficulty,
  sentenceIndex: number
): ShadowingSetHistory {
  const entry = history[difficulty];
  const activeSet = entry.sets.find(set => set.id === entry.activeSetId) ?? entry.sets[0];
  const maxIndex = Math.max(0, (activeSet?.sentences.length ?? 1) - 1);
  return {
    ...history,
    [difficulty]: { ...entry, activeSentenceIndex: Math.max(0, Math.min(maxIndex, sentenceIndex)) }
  };
}

export function appendShadowingSet(
  history: ShadowingSetHistory,
  difficulty: ShadowingDifficulty,
  sentences: ShadowingSentence[],
  id = `ai-${Date.now()}`
): ShadowingSetHistory {
  if (sentences.length !== 20 || sentences.some(sentence => !isSentence(sentence))) {
    throw new Error('A sentence set must contain exactly 20 valid sentences.');
  }
  const entry = history[difficulty];
  const nextSets: ShadowingSentenceSet[] = [
    ...entry.sets,
    { id, source: 'ai' as const, createdAt: Date.now(), sentences: sentences.map(sentence => ({ ...sentence })) }
  ].slice(-MAX_SHADOWING_SETS_PER_DIFFICULTY);
  const next = {
    ...history,
    [difficulty]: { sets: nextSets, activeSetId: id, activeSentenceIndex: 0 }
  };
  return next;
}

export function moveShadowingSet(
  history: ShadowingSetHistory,
  difficulty: ShadowingDifficulty,
  direction: -1 | 1
): ShadowingSetHistory {
  const entry = history[difficulty];
  if (entry.sets.length === 0) return history;
  const current = Math.max(0, entry.sets.findIndex(set => set.id === entry.activeSetId));
  const nextIndex = Math.max(0, Math.min(entry.sets.length - 1, current + direction));
  if (nextIndex === current) return history;
  return selectShadowingSet(history, difficulty, entry.sets[nextIndex].id, 0);
}
