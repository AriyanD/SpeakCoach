export interface SeenQuestionsState {
  seenPart1Ids: string[];
  seenCueCardIds: string[];
  seenPart3Ids: string[];
}

export const SEEN_QUESTIONS_STORAGE_KEY = 'speakcoach_seen_ielts_questions';
export const SEEN_LLM_TOPICS_KEY = 'speakcoach_seen_llm_topics';
export const RECENT_LLM_QUESTIONS_KEY = 'speakcoach_recent_llm_questions_v1';

const MAX_STORED_LLM_TOPICS = 40;
const MAX_STORED_LLM_QUESTIONS = 48;

export function getRecentLlmQuestions(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_LLM_QUESTIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string').slice(-MAX_STORED_LLM_QUESTIONS) : [];
  } catch { return []; }
}

/** Keep enough generated history to cover several complete test sets. */
export function markLlmQuestionsSeen(questions: string[]): void {
  try {
    const compact = questions.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const merged = [...getRecentLlmQuestions(), ...compact];
    const unique = Array.from(new Map(merged.map(q => [q.toLocaleLowerCase(), q])).values());
    localStorage.setItem(RECENT_LLM_QUESTIONS_KEY, JSON.stringify(unique.slice(-MAX_STORED_LLM_QUESTIONS)));
  } catch { /* local memory is best-effort */ }
}

export function restoreLlmGenerationMemory(memory: { topics?: unknown; questions?: unknown }): void {
  try {
    const topics = Array.isArray(memory.topics)
      ? memory.topics.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(-MAX_STORED_LLM_TOPICS)
      : [];
    const questions = Array.isArray(memory.questions)
      ? memory.questions.filter((item): item is string => typeof item === 'string').map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-MAX_STORED_LLM_QUESTIONS)
      : [];
    localStorage.setItem(SEEN_LLM_TOPICS_KEY, JSON.stringify(Array.from(new Set(topics))));
    localStorage.setItem(RECENT_LLM_QUESTIONS_KEY, JSON.stringify(Array.from(new Map(questions.map(q => [q.toLocaleLowerCase(), q])).values()).slice(-MAX_STORED_LLM_QUESTIONS)));
  } catch {
    // History restoration is best-effort in restricted browser contexts.
  }
}

export function getCompactLlmGenerationMemory(): { topics: string[]; questions: string[] } {
  return {
    topics: getLlmSeenTopics().slice(-40),
    questions: getRecentLlmQuestions().slice(-24)
  };
}

export function getSeenQuestions(): SeenQuestionsState {
  try {
    const raw = localStorage.getItem(SEEN_QUESTIONS_STORAGE_KEY);
    if (!raw) return { seenPart1Ids: [], seenCueCardIds: [], seenPart3Ids: [] };
    const parsed = JSON.parse(raw);
    return {
      seenPart1Ids: Array.isArray(parsed.seenPart1Ids) ? parsed.seenPart1Ids : [],
      seenCueCardIds: Array.isArray(parsed.seenCueCardIds) ? parsed.seenCueCardIds : [],
      seenPart3Ids: Array.isArray(parsed.seenPart3Ids) ? parsed.seenPart3Ids : []
    };
  } catch {
    return { seenPart1Ids: [], seenCueCardIds: [], seenPart3Ids: [] };
  }
}

export function saveSeenQuestions(state: SeenQuestionsState): void {
  try {
    localStorage.setItem(SEEN_QUESTIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors in test or restricted environments
  }
}

export function clearSeenQuestions(): void {
  try {
    localStorage.removeItem(SEEN_QUESTIONS_STORAGE_KEY);
    localStorage.removeItem(SEEN_LLM_TOPICS_KEY);
    localStorage.removeItem(RECENT_LLM_QUESTIONS_KEY);
  } catch {
    // Ignore
  }
}

/** Returns the list of topic strings from LLM-generated sessions that have been seen. */
export function getLlmSeenTopics(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_LLM_TOPICS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Persists topics produced by LLM-generated sessions to prevent near-duplicate AI questions. */
export function markLlmTopicsSeen(topics: string[]): void {
  try {
    const existing = getLlmSeenTopics();
    const updated = Array.from(new Set([...existing, ...topics.map((t) => t.trim()).filter(Boolean)])).slice(-MAX_STORED_LLM_TOPICS);
    localStorage.setItem(SEEN_LLM_TOPICS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }
}

export function markQuestionsSeen(params: {
  part1Ids?: string[];
  cueCardId?: string;
  part3Ids?: string[];
}): void {
  const current = getSeenQuestions();
  let modified = false;

  if (params.part1Ids) {
    for (const id of params.part1Ids) {
      if (!current.seenPart1Ids.includes(id)) {
        current.seenPart1Ids.push(id);
        modified = true;
      }
    }
  }

  if (params.cueCardId && !current.seenCueCardIds.includes(params.cueCardId)) {
    current.seenCueCardIds.push(params.cueCardId);
    modified = true;
  }

  if (params.part3Ids) {
    for (const id of params.part3Ids) {
      if (!current.seenPart3Ids.includes(id)) {
        current.seenPart3Ids.push(id);
        modified = true;
      }
    }
  }

  if (modified) {
    saveSeenQuestions(current);
  }
}

