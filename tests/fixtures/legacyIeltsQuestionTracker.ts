import {
  PART_1_QUESTIONS,
  PART_2_CUE_CARDS,
  PART_3_QUESTIONS,
  type IeltsPart1Question,
  type IeltsPart2CueCard,
  type IeltsPart3Question
} from './legacyIeltsQuestionBank';

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

/** Keep a bounded local history; only a tiny recent sample is sent to the model. */
export function markLlmQuestionsSeen(questions: string[]): void {
  try {
    const compact = questions.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const merged = [...getRecentLlmQuestions(), ...compact];
    const unique = Array.from(new Map(merged.map(q => [q.toLocaleLowerCase(), q])).values());
    localStorage.setItem(RECENT_LLM_QUESTIONS_KEY, JSON.stringify(unique.slice(-MAX_STORED_LLM_QUESTIONS)));
  } catch { /* local memory is best-effort */ }
}

export function getCompactLlmGenerationMemory(): { topics: string[]; questions: string[] } {
  return {
    topics: getLlmSeenTopics().slice(-12),
    questions: getRecentLlmQuestions().slice(-16).map(q => q.length > 110 ? `${q.slice(0, 107).trimEnd()}…` : q)
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

export function selectUnseenCueCard(options?: {
  preferCueCardId?: string;
  seed?: number;
}): IeltsPart2CueCard {
  const seen = getSeenQuestions();

  if (options?.preferCueCardId) {
    const specified = PART_2_CUE_CARDS.find((c) => c.id === options.preferCueCardId);
    if (specified) {
      markQuestionsSeen({ cueCardId: specified.id });
      return specified;
    }
  }

  let unseen = PART_2_CUE_CARDS.filter((c) => !seen.seenCueCardIds.includes(c.id));

  // Reset seen cue cards set ONLY when pool is exhausted
  if (unseen.length === 0) {
    seen.seenCueCardIds = [];
    saveSeenQuestions(seen);
    unseen = [...PART_2_CUE_CARDS];
  }

  const seed = options?.seed ?? Date.now();
  const index = Math.abs(seed) % unseen.length;
  const chosen = unseen[index];

  markQuestionsSeen({ cueCardId: chosen.id });
  return chosen;
}

export function selectUnseenPart1Questions(options?: {
  seed?: number;
}): { topics: string[]; questions: IeltsPart1Question[] } {
  const seen = getSeenQuestions();
  let unseen = PART_1_QUESTIONS.filter((q) => !seen.seenPart1Ids.includes(q.id));

  // Group unseen by topic
  let topicMap = new Map<string, IeltsPart1Question[]>();
  for (const q of unseen) {
    const list = topicMap.get(q.topic) || [];
    list.push(q);
    topicMap.set(q.topic, list);
  }

  // Find topics that have at least 4 unseen questions
  let viableTopics = Array.from(topicMap.keys()).filter(
    (t) => (topicMap.get(t)?.length || 0) >= 4
  );

  // If pool does not have at least 2 viable topics (or fewer than 8 questions), reset seen Part 1
  if (viableTopics.length < 2 || unseen.length < 8) {
    seen.seenPart1Ids = [];
    saveSeenQuestions(seen);
    unseen = [...PART_1_QUESTIONS];
    topicMap = new Map<string, IeltsPart1Question[]>();
    for (const q of unseen) {
      const list = topicMap.get(q.topic) || [];
      list.push(q);
      topicMap.set(q.topic, list);
    }
    viableTopics = Array.from(topicMap.keys()).filter(
      (t) => (topicMap.get(t)?.length || 0) >= 4
    );
  }

  const seed = options?.seed ?? Date.now();
  const t1Idx = Math.abs(seed) % viableTopics.length;
  const t2Idx = (t1Idx + 1) % viableTopics.length;

  const t1 = viableTopics[t1Idx];
  const t2 = viableTopics[t2Idx] || viableTopics[0];

  const q1 = (topicMap.get(t1) || []).slice(0, 4);
  const q2 = (topicMap.get(t2) || []).slice(0, 4);
  const questions = [...q1, ...q2];

  markQuestionsSeen({ part1Ids: questions.map((q) => q.id) });
  return {
    topics: [t1, t2],
    questions
  };
}

export function selectUnseenPart3Questions(cueCardId: string): IeltsPart3Question[] {
  const linked = PART_3_QUESTIONS.filter((q) => q.cueCardId === cueCardId);
  const seen = getSeenQuestions();
  let unseen = linked.filter((q) => !seen.seenPart3Ids.includes(q.id));

  // Reset seen Part 3 questions for this cue card if exhausted
  if (unseen.length === 0) {
    seen.seenPart3Ids = seen.seenPart3Ids.filter((id) => !linked.some((q) => q.id === id));
    saveSeenQuestions(seen);
    unseen = [...linked];
  }

  const chosen = unseen.length >= 3 ? unseen.slice(0, 3) : linked.slice(0, 3);
  markQuestionsSeen({ part3Ids: chosen.map((q) => q.id) });
  return chosen;
}

export function getReplacementUnseenQuestion(params: {
  part: 1 | 2 | 3;
  currentQuestionId: string;
  topic?: string;
  cueCardId?: string;
  excludeIds?: string[];
}): IeltsPart1Question | IeltsPart2CueCard | IeltsPart3Question {
  const seen = getSeenQuestions();
  const exclude = new Set([...(params.excludeIds || []), params.currentQuestionId]);

  if (params.part === 1) {
    let pool = PART_1_QUESTIONS.filter((q) => !exclude.has(q.id));
    if (params.topic) {
      const topicMatches = pool.filter((q) => q.topic === params.topic && !seen.seenPart1Ids.includes(q.id));
      if (topicMatches.length > 0) {
        markQuestionsSeen({ part1Ids: [topicMatches[0].id] });
        return topicMatches[0];
      }
    }
    let unseen = pool.filter((q) => !seen.seenPart1Ids.includes(q.id));
    if (unseen.length === 0) {
      seen.seenPart1Ids = [];
      saveSeenQuestions(seen);
      unseen = pool;
    }
    const chosen = unseen[0] || pool[0] || PART_1_QUESTIONS[0];
    markQuestionsSeen({ part1Ids: [chosen.id] });
    return chosen;
  }

  if (params.part === 2) {
    let pool = PART_2_CUE_CARDS.filter((c) => !exclude.has(c.id));
    let unseen = pool.filter((c) => !seen.seenCueCardIds.includes(c.id));
    if (unseen.length === 0) {
      seen.seenCueCardIds = [];
      saveSeenQuestions(seen);
      unseen = pool;
    }
    const chosen = unseen[0] || pool[0] || PART_2_CUE_CARDS[0];
    markQuestionsSeen({ cueCardId: chosen.id });
    return chosen;
  }

  // Part 3
  const pool = PART_3_QUESTIONS.filter((q) => !exclude.has(q.id));
  if (params.cueCardId) {
    const cueMatches = pool.filter((q) => q.cueCardId === params.cueCardId && !seen.seenPart3Ids.includes(q.id));
    if (cueMatches.length > 0) {
      markQuestionsSeen({ part3Ids: [cueMatches[0].id] });
      return cueMatches[0];
    }
  }
  let unseen = pool.filter((q) => !seen.seenPart3Ids.includes(q.id));
  if (unseen.length === 0) {
    seen.seenPart3Ids = [];
    saveSeenQuestions(seen);
    unseen = pool;
  }
  const chosen = unseen[0] || pool[0] || PART_3_QUESTIONS[0];
  markQuestionsSeen({ part3Ids: [chosen.id] });
  return chosen;
}
