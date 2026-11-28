export interface SeenQuestionsState {
  seenPart1Ids: string[];
  seenCueCardIds: string[];
  seenPart3Ids: string[];
}

export const SEEN_QUESTIONS_STORAGE_KEY = 'speakcoach_seen_ielts_questions';
export const SEEN_LLM_TOPICS_KEY = 'speakcoach_seen_llm_topics';
export const RECENT_LLM_QUESTIONS_KEY = 'speakcoach_recent_llm_questions_v1';
export const RECENT_LLM_TITLES_KEY = 'speakcoach_recent_llm_cue_titles_v1';
export const RECENT_LLM_PART1_TOPICS_KEY = 'speakcoach_recent_llm_part1_topics_v1';

const MAX_STORED_LLM_TOPICS = 20;
const MAX_STORED_LLM_QUESTIONS = 80;
const MAX_STORED_LLM_TITLES = 40;
const MAX_STORED_PART1_TOPICS = 40;

function readStrings(key: string, limit: number): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').map(value => value.trim()).filter(Boolean).slice(-limit) : [];
  } catch { return []; }
}
function writeUnique(key: string, values: string[], limit: number): void {
  try {
    const merged = [...readStrings(key, limit), ...values.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)];
    const unique: string[] = [];
    for (const value of merged) {
      const existing = unique.findIndex(item => item.toLocaleLowerCase() === value.toLocaleLowerCase());
      if (existing >= 0) unique.splice(existing, 1);
      unique.push(value);
    }
    localStorage.setItem(key, JSON.stringify(unique.slice(-limit)));
  } catch { /* local generation memory is best-effort */ }
}
export function getRecentLlmQuestions(): string[] { return readStrings(RECENT_LLM_QUESTIONS_KEY, MAX_STORED_LLM_QUESTIONS); }
export function getRecentLlmTitles(): string[] { return readStrings(RECENT_LLM_TITLES_KEY, MAX_STORED_LLM_TITLES); }
export function markLlmQuestionsSeen(questions: string[]): void { writeUnique(RECENT_LLM_QUESTIONS_KEY, questions, MAX_STORED_LLM_QUESTIONS); }
export function markLlmTitlesSeen(titles: string[]): void { writeUnique(RECENT_LLM_TITLES_KEY, titles, MAX_STORED_LLM_TITLES); }
export function getRecentLlmPart1Topics(): string[] { return readStrings(RECENT_LLM_PART1_TOPICS_KEY, MAX_STORED_PART1_TOPICS); }
export function markLlmPart1TopicsSeen(topics: string[]): void { writeUnique(RECENT_LLM_PART1_TOPICS_KEY, topics, MAX_STORED_PART1_TOPICS); }

export function restoreLlmGenerationMemory(memory: { topics?: unknown; questions?: unknown; titles?: unknown; part1Topics?: unknown }): void {
  try {
    const topics = Array.isArray(memory.topics) ? memory.topics.filter((item): item is string => typeof item === 'string').slice(-MAX_STORED_LLM_TOPICS) : [];
    const legacy = Array.isArray(memory.questions) ? memory.questions.filter((item): item is string => typeof item === 'string') : [];
    const questions = legacy.filter(item => item.includes('?'));
    const titles = [
      ...(Array.isArray(memory.titles) ? memory.titles.filter((item): item is string => typeof item === 'string') : []),
      ...legacy.filter(item => !item.includes('?'))
    ];
    localStorage.setItem(SEEN_LLM_TOPICS_KEY, JSON.stringify(Array.from(new Set(topics))));
    localStorage.setItem(RECENT_LLM_QUESTIONS_KEY, JSON.stringify(Array.from(new Map(questions.map(q => [q.toLocaleLowerCase(), q])).values()).slice(-MAX_STORED_LLM_QUESTIONS)));
    localStorage.setItem(RECENT_LLM_TITLES_KEY, JSON.stringify(Array.from(new Map(titles.map(q => [q.toLocaleLowerCase(), q])).values()).slice(-MAX_STORED_LLM_TITLES)));
    const part1Topics = Array.isArray(memory.part1Topics) ? memory.part1Topics.filter((item): item is string => typeof item === 'string').slice(-MAX_STORED_PART1_TOPICS) : [];
    localStorage.setItem(RECENT_LLM_PART1_TOPICS_KEY, JSON.stringify(part1Topics));
  } catch { /* restore remains backward-compatible and best-effort */ }
}

export function getCompactLlmGenerationMemory(): { topics: string[]; questions: string[]; titles: string[] } {
  return {
    topics: getLlmSeenTopics().slice(-MAX_STORED_LLM_TOPICS),
    questions: getRecentLlmQuestions(),
    titles: getRecentLlmTitles()
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
  } catch { return { seenPart1Ids: [], seenCueCardIds: [], seenPart3Ids: [] }; }
}
export function saveSeenQuestions(state: SeenQuestionsState): void {
  try { localStorage.setItem(SEEN_QUESTIONS_STORAGE_KEY, JSON.stringify(state)); } catch { /* restricted storage */ }
}
export function clearSeenQuestions(): void {
  try {
    localStorage.removeItem(SEEN_QUESTIONS_STORAGE_KEY);
    localStorage.removeItem(SEEN_LLM_TOPICS_KEY);
    localStorage.removeItem(RECENT_LLM_QUESTIONS_KEY);
    localStorage.removeItem(RECENT_LLM_TITLES_KEY);
    localStorage.removeItem(RECENT_LLM_PART1_TOPICS_KEY);
  } catch { /* ignore */ }
}
export function getLlmSeenTopics(): string[] { return readStrings(SEEN_LLM_TOPICS_KEY, MAX_STORED_LLM_TOPICS); }
export function markLlmTopicsSeen(topics: string[]): void { writeUnique(SEEN_LLM_TOPICS_KEY, topics, MAX_STORED_LLM_TOPICS); }

export function markQuestionsSeen(params: { part1Ids?: string[]; cueCardId?: string; part3Ids?: string[] }): void {
  const current = getSeenQuestions();
  let modified = false;
  for (const id of params.part1Ids ?? []) if (!current.seenPart1Ids.includes(id)) { current.seenPart1Ids.push(id); modified = true; }
  if (params.cueCardId && !current.seenCueCardIds.includes(params.cueCardId)) { current.seenCueCardIds.push(params.cueCardId); modified = true; }
  for (const id of params.part3Ids ?? []) if (!current.seenPart3Ids.includes(id)) { current.seenPart3Ids.push(id); modified = true; }
  if (modified) saveSeenQuestions(current);
}
