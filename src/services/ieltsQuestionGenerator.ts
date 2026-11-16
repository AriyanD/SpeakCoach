import type { SlotConfig } from '../config/types';
import { getPreset, normalizeBaseUrl } from '../config/providers';
import { loadAllSlotsConfig } from '../storage/localStore';
import { loadApiKey } from '../storage/keyStore';
import { resolveSlotTier } from './tierManager';
import { runWithSlotApiFallback } from './apiFallback';
import {
  buildCustomEndpointRequest,
  buildGeminiEndpointRequest,
  resolveWireFormat
} from './customEndpointHelper';
import { nativeHttpRequest } from './httpClient';
import { cleanJsonPayload } from './ieltsLlmEvaluator';
import type {
  IeltsPart1Question,
  IeltsPart2CueCard,
  IeltsPart3Question,
  IeltsTestSessionPlan
} from '../data/ieltsQuestionTypes';
import { markQuestionsSeen, markLlmTopicsSeen, markLlmQuestionsSeen, getCompactLlmGenerationMemory } from './ieltsQuestionTracker';
import type { IeltsTestMode } from './ieltsSessionEngine';
import { replaceUncompletedIeltsQuestionSets, type StoredIeltsQuestionSet } from './ieltsQuestionSetStore';

export class LlmQuestionGenerationError extends Error {
  constructor(
    message: string,
    public readonly providerName?: string,
    public readonly modelName?: string,
    public readonly cause?: unknown,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'LlmQuestionGenerationError';
  }
}

export interface LlmQuestionPlanResult {
  plan: IeltsTestSessionPlan;
  source: 'online_ai' | 'offline_bank';
  providerName?: string;
  modelName?: string;
  questionsCount?: {
    part1: number;
    part2: number;
    part3: number;
    total: number;
  };
  fallbackReason?: string;
}

export interface IeltsGenerationContext {
  id: string;
  createdAt: string;
  preferredAngles: string[];
  part1Topics: [string, string];
  cueCardType: string;
  part3Angles: [string, string];
}

const PART1_TOPIC_POOL = [
  'Accommodation', 'Art and drawing', 'Books and reading', 'Clothing and fashion',
  'Daily routines', 'Dreams and ambitions', 'Exercise and sport', 'Family celebrations',
  'Hometown', 'Work and study',
  'Flowers and plants', 'Food markets', 'Giving and receiving gifts', 'Handwriting',
  'Hobbies and collections', 'Home cooking', 'Keeping in touch', 'Local shops',
  'Maps and directions', 'Museums and exhibitions', 'Names and naming', 'Neighbours',
  'Outdoor activities', 'Photography', 'Public transport', 'Quiet places',
  'Rainy weather', 'School memories', 'Science in daily life', 'Seasons',
  'Shopping habits', 'Social occasions', 'Street markets', 'Team activities',
  'The countryside', 'Time management', 'Traditional objects', 'Travel planning',
  'Trees and green spaces', 'Using the internet', 'Volunteering', 'Walking',
  'Weekend activities', 'Workplace routines', 'Learning practical skills',
  'Libraries', 'Public parks', 'Languages', 'Music performances',
  'Household chores', 'Childhood games', 'Local festivals', 'Bicycles',
  'Public services', 'Making things by hand', 'Weather forecasts',
  'Personal possessions', 'Community events', 'Healthy routines',
  'Restaurants and cafés', 'Helping other people', 'Technology at home'
];

const GENERATION_ANGLE_POOL = [
  'community life and local services', 'personal decisions and changing priorities',
  'objects people keep, repair or pass on', 'workplace culture and everyday routines',
  'public spaces and the built environment', 'friendship, family and social expectations',
  'learning methods and practical skills', 'nature, weather and environmental habits',
  'arts, stories and cultural experiences', 'technology in ordinary daily life',
  'travel choices and unfamiliar places', 'food traditions and shared meals',
  'time management and leisure', 'communication across generations',
  'consumer choices and the life of products', 'celebrations and social events',
  'health habits and public wellbeing', 'creativity, problem-solving and invention'
];

const CUE_CARD_TYPES = [
  'person', 'place', 'object', 'event', 'decision',
  'skill', 'activity', 'piece of media', 'situation'
];

const PART3_ANGLE_POOL = [
  'changes across generations', 'causes and wider effects',
  'the role of public services and policy', 'differences between communities',
  'economic pressures and consumer choices', 'environmental consequences',
  'the influence of technology on society', 'education and the transfer of skills',
  'social relationships and shared responsibilities', 'future trends and possible trade-offs',
  'cultural expectations and changing values', 'the balance between individual and collective needs'
];

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function chooseFreshPart1Topics(excludedTopics: string[]): [string, string] {
  const excluded = new Set(excludedTopics.map(topic => topic.trim().toLocaleLowerCase()));
  const fresh = shuffled(PART1_TOPIC_POOL.filter(topic => !excluded.has(topic.toLocaleLowerCase())));
  const selected = fresh.length >= 2 ? fresh.slice(0, 2) : shuffled(PART1_TOPIC_POOL).slice(0, 2);
  return [selected[0], selected[1]];
}

export function createIeltsGenerationContext(excludedTopics: string[] = []): IeltsGenerationContext {
  const angles = shuffled(PART3_ANGLE_POOL);
  const randomPart = () => Math.random().toString(36).slice(2, 9);
  return {
    id: `ielts-gen-${Date.now().toString(36)}-${randomPart()}-${randomPart()}`,
    createdAt: new Date().toISOString(),
    preferredAngles: shuffled(GENERATION_ANGLE_POOL).slice(0, 5),
    part1Topics: chooseFreshPart1Topics(excludedTopics),
    cueCardType: shuffled(CUE_CARD_TYPES)[0],
    part3Angles: [angles[0], angles[1]]
  };
}

export function buildGeneratorPrompt(
  excludedTopics: string[],
  recentQuestions: string[] = [],
  requestedTopic = '',
  context: IeltsGenerationContext = createIeltsGenerationContext(excludedTopics)
): { system: string; user: string } {
  // IELTS Part 1 is a broad personal interview. A user-selected theme must
  // never turn the warm-up into a single-topic interview.
  const assignedTopics: [string, string] = context.part1Topics;
  const topicsNote = excludedTopics.length
    ? `\nRecent topics already used (avoid these and close semantic variants, except that an explicitly requested Part 2/3 theme must still be honoured): ${excludedTopics.slice(-24).join(', ')}.`
    : '';
  const cueTitleNote = recentQuestions.length
    ? `\nRecent questions and cue-card titles (do not repeat or closely paraphrase): ${recentQuestions.slice(-16).map(q => `"${q}"`).join(' | ')}.`
    : '';
  const requestedTopicNote = requestedTopic.trim()
    ? `\nUSER-SELECTED THEME FOR PARTS 2 & 3: "${requestedTopic.trim()}". Make Part 2's cue card clearly and naturally about this theme, choosing a cue-card format that genuinely fits it. Part 3 must develop a broader discussion connected to the same theme. Do not force this theme into Part 1.`
    : '';
  const assignment = `\nTHIS SET'S ASSIGNMENT — follow it exactly:
- Part 1 topic A: "${assignedTopics[0]}"
- Part 1 topic B: "${assignedTopics[1]}"
- Part 2: ${requestedTopic.trim() ? `create a specific, concrete IELTS cue card naturally centred on the user's selected theme; choose the most suitable cue-card type for that theme` : `cue-card type: ${context.cueCardType}. Choose a specific, concrete subject of this type that an ordinary person could describe for two minutes`}.
- Part 3 analytical angles: ${context.part3Angles[0]} AND ${context.part3Angles[1]}. Apply different angles to discussion questions connected to the Part 2 theme.`;
  const preferredAnglesNote = requestedTopic.trim()
    ? ''
    : `\\nCREATIVE DIVERSITY LENSES: ${context.preferredAngles.join('; ')}. Choose one or two lenses to inspire a concrete, everyday Part 2 subject. Treat them as creative directions, not abstract cue-card titles; do not force them into Part 1.`;

  const system = `You are an expert IELTS Speaking test writer. Write one realistic, natural IELTS Speaking test set in the style of Cambridge IELTS practice tests. Do not claim it is official or from a real exam.
${topicsNote}${cueTitleNote}${requestedTopicNote}${assignment}${preferredAnglesNote}

CONTENT RULES:
- Part 1: use exactly the two assigned everyday topics, with 3 questions for each (6 total). These topics are independently selected for a realistic IELTS warm-up and MUST NOT be replaced or narrowed by the user's optional theme. Questions must be personal, accessible and invite different kinds of answers: habits, past experiences, preferences, reasons, changes or comparisons.
- Part 2: when a user-selected theme is supplied, make the cue card clearly and naturally about that theme and choose a suitable IELTS cue-card format; otherwise follow the assigned random cue-card type. Pick a concrete, specific subject. Use a natural "Describe ..." prompt and exactly four useful bullets. The fourth bullet should ask why it matters or how the speaker feels.
- Part 3: write exactly 4 broader discussion questions connected to the Part 2 theme. Move from the specific cue-card subject to the two assigned analytical angles. Each question must explore a distinct issue, not paraphrase another.
- Avoid reusing any recent topic, cue-card title or question listed above. Avoid close semantic equivalents, not merely identical wording.
- Vary sentence openings and grammatical structures. Do not begin multiple questions in a part with the same phrase.
- Keep questions concise, idiomatic, unambiguous and suitable for spoken answers. Avoid obscure knowledge and overly academic wording.
- Make the set coherent but not repetitive: Part 1 is a light warm-up, Part 2 a two-minute individual turn, and Part 3 a broader discussion.

OUTPUT:
Return ONLY raw JSON with this structure. Replace every placeholder with real content; never copy placeholder wording:
{
  "part1Topics": ["<assigned topic A>", "<assigned topic B>"],
  "part1Questions": [
    {"topic": "<assigned topic A>", "question": "<question>"},
    {"topic": "<assigned topic A>", "question": "<question>"},
    {"topic": "<assigned topic A>", "question": "<question>"},
    {"topic": "<assigned topic B>", "question": "<question>"},
    {"topic": "<assigned topic B>", "question": "<question>"},
    {"topic": "<assigned topic B>", "question": "<question>"}
  ],
  "part2CueCard": {
    "topic": "<specific theme>",
    "title": "<specific short title>",
    "prompt": "<one sentence beginning with Describe>",
    "bullets": ["<bullet 1>", "<bullet 2>", "<bullet 3>", "<bullet 4>"]
  },
  "part3Questions": [
    {"topic": "<same theme>", "question": "<distinct analytical question 1>"},
    {"topic": "<same theme>", "question": "<distinct analytical question 2>"},
    {"topic": "<same theme>", "question": "<distinct analytical question 3>"},
    {"topic": "<same theme>", "question": "<distinct analytical question 4>"}
  ]
}
Do not include markdown, code fences, preamble or commentary.`;

  const user = 'Create exactly one complete IELTS Speaking test set. Follow every assignment, diversity and output-format requirement in the system instructions; return only the requested JSON.';

  return { system, user };
}

function normalizeGenerationText(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const TOPIC_STOP_WORDS = new Set(['a', 'an', 'and', 'about', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'your', 'my', 'our', 'their', 'topic']);
const QUESTION_STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'should', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'those', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'would', 'you', 'your']);

function meaningfulTokens(value: string, stopWords: Set<string>): Set<string> {
  const tokens = normalizeGenerationText(value).split(/\s+/).map(token => token.endsWith('ies') && token.length > 4 ? `${token.slice(0, -3)}y` : token.endsWith('s') && token.length > 4 ? token.slice(0, -1) : token);
  return new Set(tokens.filter(token => token.length > 2 && !stopWords.has(token)));
}

function topicMatchesAssigned(actual: string, assigned: string): boolean {
  const actualTokens = meaningfulTokens(actual, TOPIC_STOP_WORDS);
  const assignedTokens = meaningfulTokens(assigned, TOPIC_STOP_WORDS);
  if (!actualTokens.size || !assignedTokens.size) return false;
  if (normalizeGenerationText(actual) === normalizeGenerationText(assigned)) return true;
  const overlap = [...actualTokens].filter(token => assignedTokens.has(token)).length;
  return overlap / Math.min(actualTokens.size, assignedTokens.size) >= 0.8;
}

function hasRecentQuestionOverlap(question: string, recentQuestions: string[]): boolean {
  const current = meaningfulTokens(question, QUESTION_STOP_WORDS);
  if (!current.size) return false;
  for (const recent of recentQuestions) {
    if (normalizeGenerationText(question) === normalizeGenerationText(recent)) return true;
    const previous = meaningfulTokens(recent, QUESTION_STOP_WORDS);
    if (Math.min(current.size, previous.size) < 4) continue;
    const intersection = [...current].filter(token => previous.has(token)).length;
    const jaccard = intersection / new Set([...current, ...previous]).size;
    if (jaccard >= 0.72) return true;
  }
  return false;
}

function getPlanGenerationMemory(plan: IeltsTestSessionPlan): { topics: string[]; questions: string[] } {
  return {
    topics: Array.from(new Set([
      ...plan.part1Questions.map(question => question.topic),
      plan.part2CueCard.topic,
      ...plan.part3Questions.map(question => question.topic)
    ])),
    questions: [
      ...plan.part1Questions.map(question => question.question),
      plan.part2CueCard.title,
      ...plan.part3Questions.map(question => question.question)
    ]
  };
}

function commitGeneratedPlansMemory(plans: IeltsTestSessionPlan[]): void {
  for (const plan of plans) {
    markQuestionsSeen({
      part1Ids: plan.part1Questions.map(question => question.id),
      cueCardId: plan.part2CueCard.id,
      part3Ids: plan.part3Questions.map(question => question.id)
    });
  }
  const memory = plans.map(getPlanGenerationMemory);
  markLlmTopicsSeen(memory.flatMap(item => item.topics));
  markLlmQuestionsSeen(memory.flatMap(item => item.questions));
}

export function parseLlmSessionPlanResponse(rawText: string, options: {
  generationContext?: IeltsGenerationContext;
  recentQuestions?: string[];
  persistMemory?: boolean;
} = {}): IeltsTestSessionPlan & {
  questionsCount: { part1: number; part2: number; part3: number; total: number };
} {
  if (!rawText || !rawText.trim()) {
    throw new Error('AI returned an empty response text');
  }

  const cleaned = cleanJsonPayload(rawText);
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse LLM question JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const timestamp = Date.now();
  const sessionId = `session_llm_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. Part 1 questions — flexible property name matching
  const rawP1 = parsed.part1Questions ?? parsed.part1_questions ?? parsed.part_1_questions ?? parsed.part1;
  if (!Array.isArray(rawP1) || rawP1.length === 0) {
    throw new Error('LLM question plan missing valid part1Questions array');
  }
  const part1Questions: IeltsPart1Question[] = rawP1
    .map((q: any, idx: number): IeltsPart1Question => ({
      id: `llm_p1_${idx + 1}_${timestamp}`,
      topic: String(q.topic || q.theme || 'General').trim(),
      question: String(q.question || q.prompt || q.text || '').trim()
    }))
    .filter((q: IeltsPart1Question) => q.question.length > 0);

  if (part1Questions.length < 6 || part1Questions.length > 8) {
    throw new Error(`LLM must generate 6–8 valid Part 1 questions (got ${part1Questions.length})`);
  }
  if (options.generationContext) {
    const assigned = options.generationContext.part1Topics;
    for (const question of part1Questions) {
      const match = assigned.find(topic => topicMatchesAssigned(question.topic, topic));
      if (!match) {
        throw new Error(`Part 1 topic mismatch: expected one of "${assigned[0]}" or "${assigned[1]}", received "${question.topic}".`);
      }
      question.topic = match;
    }
    const declaredTopics = Array.isArray(parsed.part1Topics ?? parsed.part1_topics ?? parsed.part_1_topics)
      ? (parsed.part1Topics ?? parsed.part1_topics ?? parsed.part_1_topics).map((topic: unknown) => String(topic))
      : [];
    for (const declared of declaredTopics) {
      if (!assigned.some(topic => topicMatchesAssigned(declared, topic))) {
        throw new Error(`Part 1 declared topic mismatch: "${declared}" was not assigned to this set.`);
      }
    }
  }

  const part1TopicCounts = new Map<string, number>();
  for (const question of part1Questions) {
    const topicKey = question.topic.toLocaleLowerCase();
    part1TopicCounts.set(topicKey, (part1TopicCounts.get(topicKey) ?? 0) + 1);
  }
  if (part1TopicCounts.size !== 2 || Array.from(part1TopicCounts.values()).some(count => count < 3 || count > 4)) {
    throw new Error('Part 1 must contain exactly two distinct everyday topics, with three or four questions per topic (six to eight total).');
  }

  // 2. Part 2 cue card — flexible property name matching
  const p2 = parsed.part2CueCard ?? parsed.part2_cue_card ?? parsed.part_2_cue_card ?? parsed.cueCard ?? parsed.cue_card ?? parsed.part2;
  if (!p2 || typeof p2 !== 'object') {
    throw new Error('LLM question plan missing valid part2CueCard');
  }
  const cueCardId = `llm_p2_cc_${timestamp}`;
  const rawBullets: string[] = Array.isArray(p2.bullets ?? p2.points ?? p2.subprompts)
    ? (p2.bullets ?? p2.points ?? p2.subprompts).map((b: any) => String(b).trim())
    : [];
  if (rawBullets.length !== 4 || rawBullets.some(bullet => !bullet)) {
    throw new Error('Part 2 cue card must contain exactly four non-empty bullet points.');
  }
  const bullets: [string, string, string, string] = [
    rawBullets[0], rawBullets[1], rawBullets[2], rawBullets[3]
  ];

  const p2Title = String(p2.title || '').trim();
  const p2Prompt = String(p2.prompt || '').trim();
  const p2Topic = String(p2.topic || p2Title).trim();
  if (!p2Title || !p2Prompt || !p2Topic) {
    throw new Error('Part 2 cue card must include a title, a full prompt and a topic.');
  }

  const part2CueCard: IeltsPart2CueCard = {
    id: cueCardId,
    topic: p2Topic,
    title: p2Title,
    prompt: p2Prompt,
    bullets
  };

  // 3. Part 3 questions — flexible property name matching
  const rawP3 = parsed.part3Questions ?? parsed.part3_questions ?? parsed.part_3_questions ?? parsed.part3;
  if (!Array.isArray(rawP3) || rawP3.length === 0) {
    throw new Error('LLM question plan missing valid part3Questions array');
  }
  const part3Questions: IeltsPart3Question[] = rawP3
    .map((q: any, idx: number): IeltsPart3Question => ({
      id: `llm_p3_${idx + 1}_${timestamp}`,
      cueCardId,
      topic: String(q.topic || p2Topic).trim(),
      question: String(q.question || q.prompt || q.text || '').trim()
    }))
    .filter((q: IeltsPart3Question) => q.question.length > 0);

  if (part3Questions.length < 4 || part3Questions.length > 5) {
    throw new Error(`Part 3 must contain four or five valid discussion questions (got ${part3Questions.length}).`);
  }

  const normalizeQuestionText = (value: string) =>
    value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const allQuestionTexts = [
    ...part1Questions.map(question => normalizeQuestionText(question.question)),
    ...part3Questions.map(question => normalizeQuestionText(question.question))
  ];
  if (new Set(allQuestionTexts).size !== allQuestionTexts.length) {
    throw new Error('The generated set contains duplicate question wording. Generate a more varied set.');
  }
  const recentQuestions = options.recentQuestions ?? [];
  const recentOverlap = [
    ...part1Questions.map(question => question.question),
    part2CueCard.title,
    ...part3Questions.map(question => question.question)
  ].find(question => hasRecentQuestionOverlap(question, recentQuestions));
  if (recentOverlap) {
    throw new Error(`The generated set repeats or closely paraphrases a recent question: "${recentOverlap}".`);
  }

  const rawP1Topics = parsed.part1Topics ?? parsed.part1_topics ?? parsed.part_1_topics;
  const part1Topics = options.generationContext
    ? [...options.generationContext.part1Topics]
    : Array.isArray(rawP1Topics) && rawP1Topics.length > 0
      ? rawP1Topics.map((t: any) => String(t).trim())
      : Array.from(new Set(part1Questions.map((q: IeltsPart1Question) => q.topic)));

  const plan: IeltsTestSessionPlan = {
    id: sessionId,
    part1Topics,
    part1Questions,
    part2CueCard,
    part3Questions
  };

  // Parsing is side-effect free for batch generation. Callers explicitly commit
  // memory only after the corresponding question set has been saved.
  if (options.persistMemory !== false) commitGeneratedPlansMemory([plan]);

  return Object.assign(plan, {
    questionsCount: {
      part1: part1Questions.length,
      part2: 1,
      part3: part3Questions.length,
      total: part1Questions.length + 1 + part3Questions.length
    }
  });
}

export async function requestLlmSessionPlan(params: {
  slotConfig: SlotConfig;
  apiKey: string;
  mode?: IeltsTestMode;
  transport?: (opts: any) => Promise<any>;
  requestedTopic?: string;
  generationContext?: IeltsGenerationContext;
  generationMemory?: { topics: string[]; questions: string[] };
  strictValidation?: boolean;
  deferMemoryCommit?: boolean;
}): Promise<IeltsTestSessionPlan> {
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl);
  // Only AI-generated topic/question memory is used. The retired built-in
  // question bank is deliberately not imported into the production generator.
  const compactMemory = params.generationMemory ?? getCompactLlmGenerationMemory();
  const excludedTopics = compactMemory.topics;
  const generationContext = params.generationContext ?? createIeltsGenerationContext(excludedTopics);
  const prompt = buildGeneratorPrompt(excludedTopics, compactMemory.questions, params.requestedTopic ?? '', generationContext);
  const wireFormat = resolveWireFormat({ ...params.slotConfig, baseUrl });

  let rawResponseText = '';

  if (wireFormat === 'gemini') {
    const model = (params.slotConfig.modelOrVoice || 'gemini-3.5-flash-lite').trim();
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const prepared = buildGeminiEndpointRequest({
      baseUrl,
      defaultPath: `/${modelPath}:generateContent`,
      apiKey: params.apiKey,
      slotConfig: params.slotConfig
    });

    const res = await nativeHttpRequest<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      {
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          contents: [
            { role: 'user', parts: [{ text: `${prompt.system}\n\n${prompt.user}` }] }
          ],
          generationConfig: {
            temperature: 0.95,
            responseMimeType: 'application/json'
          }
        },
        timeoutMs: 45000,
        maxRetries: 1
      },
      params.transport
    );

    const body: any = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    const parts = body?.candidates?.[0]?.content?.parts;
    const textPart = Array.isArray(parts) ? parts.find((p: any) => typeof p?.text === 'string') : null;
    rawResponseText = textPart?.text ?? parts?.[0]?.text ?? '';
  } else {
    // OpenAI / Groq / Custom OpenAI-compatible
    const model = (params.slotConfig.modelOrVoice || 'gpt-4o-mini').trim();
    const prepared = buildCustomEndpointRequest({
      baseUrl,
      defaultPath: '/chat/completions',
      apiKey: params.apiKey,
      slotConfig: params.slotConfig,
      defaultHeaders: {
        'Content-Type': 'application/json'
      }
    });

    const res = await nativeHttpRequest<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(
      {
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          temperature: 0.95,
          response_format: { type: 'json_object' }
        },
        timeoutMs: 45000,
        maxRetries: 1
      },
      params.transport
    );

    const body: any = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    rawResponseText = body?.choices?.[0]?.message?.content ?? '';
  }

  return parseLlmSessionPlanResponse(rawResponseText, {
    generationContext: params.strictValidation ? generationContext : undefined,
    recentQuestions: params.strictValidation ? compactMemory.questions : [],
    persistMemory: !params.deferMemoryCommit
  });
}

export async function generateIeltsPlanWithTierFallback(options?: {
  mode?: IeltsTestMode;
  transport?: (opts: any) => Promise<any>;
  /** @deprecated Kept for compatibility; built-in IELTS question fallback is retired. */
  allowBuiltinFallback?: boolean;
  requestedTopic?: string;
  generationContext?: IeltsGenerationContext;
  generationMemory?: { topics: string[]; questions: string[] };
  strictValidation?: boolean;
  deferMemoryCommit?: boolean;
}): Promise<LlmQuestionPlanResult> {
  let fallbackReason: string | undefined;
  let configuredProviderName: string | undefined;
  let configuredModelName: string | undefined;
  const generationMemory = options?.generationMemory ?? getCompactLlmGenerationMemory();
  const generationContext = options?.generationContext ?? createIeltsGenerationContext(generationMemory.topics);
  // IELTS question sets must be AI-generated. Keep the option in the public
  // signature for compatibility with older callers, but never use the legacy bank.
  try {
    const configs = await loadAllSlotsConfig();
    const genCfg = configs.llm_generator;
    const preset = getPreset('llm_generator', genCfg.providerId);
    configuredProviderName = preset.name;
    configuredModelName = (genCfg.modelOrVoice || preset.defaultModelOrVoice).trim();

    if (preset.tier === 3) {
      throw new LlmQuestionGenerationError(
        'Choose and test an Online AI provider for IELTS question generation.',
        preset.name,
        configuredModelName,
        'Online AI provider required'
      );
    }

    const apiKey = await loadApiKey('llm_generator', genCfg.providerId);
    const secondaryReady = !!genCfg.secondary?.verified && !!(await loadApiKey('llm_generator', genCfg.secondary.providerId, 'secondary')).trim();
    const hasKey = !!(apiKey && apiKey.trim().length > 0) || secondaryReady;

    if (preset.requiresKey && !hasKey) {
      throw new LlmQuestionGenerationError(
        `No API key configured for ${preset.name}. Add an API key and test the provider before generating IELTS questions.`,
        preset.name,
        configuredModelName,
        'No API key configured'
      );
    }

    const resolved = await resolveSlotTier(genCfg);

    if (resolved.tier < 3 && resolved.label === 'Online AI') {
      const attempt = await runWithSlotApiFallback('llm_generator', genCfg, (apiConfig, apiKeyForAttempt) =>
        requestLlmSessionPlan({
          slotConfig: apiConfig,
          apiKey: apiKeyForAttempt,
          mode: options?.mode,
          transport: options?.transport,
          requestedTopic: options?.requestedTopic,
          generationContext,
          generationMemory,
          strictValidation: options?.strictValidation,
          deferMemoryCommit: true
        })
      );
      const plan = attempt.result;
      const actualPreset = getPreset('llm_generator', attempt.config.providerId);

      const parsedPlan = plan as IeltsTestSessionPlan & {
        questionsCount?: { part1: number; part2: number; part3: number; total: number };
      };

      if (!options?.deferMemoryCommit) commitGeneratedPlansMemory([plan]);
      return {
        plan: parsedPlan,
        source: 'online_ai',
        providerName: actualPreset.name,
        modelName: attempt.config.modelOrVoice,
        questionsCount: parsedPlan.questionsCount ?? {
          part1: plan.part1Questions.length,
          part2: 1,
          part3: plan.part3Questions.length,
          total: plan.part1Questions.length + 1 + plan.part3Questions.length
        }
      };
    } else {
      fallbackReason = resolved.reason || `Slot 5 auto-fallback: ${resolved.detailLabel}`;
    }
  } catch (err: any) {
    fallbackReason = err instanceof Error ? err.message : String(err);
    console.warn('[ieltsQuestionGenerator] Online AI question generation failed:', err);
    const retryableContentError = err instanceof Error && /parse LLM question JSON|empty response|missing valid part|must generate|must contain|must include|topic mismatch|duplicate question|repeats or closely paraphrases|Part 1 must contain/i.test(err.message);
    throw new LlmQuestionGenerationError(
      `${configuredProviderName || 'AI Question Generator'}${configuredModelName ? ` (${configuredModelName})` : ''}: ${fallbackReason}`,
      configuredProviderName,
      configuredModelName,
      err,
      retryableContentError
    );
  }

  // Never substitute prewritten questions for an AI request.
  const provider = configuredProviderName || 'AI Question Generator';
  const model = configuredModelName ? ` (${configuredModelName})` : '';
  throw new LlmQuestionGenerationError(
    `${provider}${model}: ${fallbackReason || 'An online AI provider is required for IELTS question generation.'}`,
    configuredProviderName,
    configuredModelName,
    fallbackReason || 'Online AI provider required'
  );
}


/**
 * Generate several complete AI-only IELTS sets and persist them in the local library.
 * Calls are sequential so each generated set can inform the next call's duplicate-topic guard.
 */
export async function generateIeltsQuestionSets(
  count = 5,
  options?: { transport?: (opts: any) => Promise<any>; requestedTopic?: string }
): Promise<StoredIeltsQuestionSet[]> {
  const target = Math.max(1, Math.min(5, Math.floor(count)));
  const generated: Array<{ plan: IeltsTestSessionPlan; providerName?: string; modelName?: string }> = [];
  const baseMemory = getCompactLlmGenerationMemory();
  const batchTopics: string[] = [];
  const batchQuestions: string[] = [];
  let attempts = 0;
  const maxAttempts = target + 5;

  while (generated.length < target && attempts < maxAttempts) {
    attempts++;
    const generationMemory = {
      topics: [...baseMemory.topics, ...batchTopics].slice(-40),
      questions: [...baseMemory.questions, ...batchQuestions].slice(-24)
    };
    const generationContext = createIeltsGenerationContext(generationMemory.topics);
    try {
      const result = await generateIeltsPlanWithTierFallback({
        transport: options?.transport,
        requestedTopic: options?.requestedTopic,
        allowBuiltinFallback: false,
        generationContext,
        generationMemory,
        strictValidation: true,
        deferMemoryCommit: true
      });
      if (result.source !== 'online_ai' || !result.plan.id.includes('llm')) {
        throw new LlmQuestionGenerationError(
          'IELTS question library accepts AI-generated sets only. Built-in question bank results are not added.',
          result.providerName,
          result.modelName
        );
      }
      generated.push({
        plan: result.plan,
        providerName: result.providerName,
        modelName: result.modelName
      });
      const planMemory = getPlanGenerationMemory(result.plan);
      batchTopics.push(...planMemory.topics);
      batchQuestions.push(...planMemory.questions);
    } catch (error) {
      if (!(error instanceof LlmQuestionGenerationError) || !error.retryable) throw error;
      if (attempts >= maxAttempts) break;
      console.warn(`[ieltsQuestionGenerator] Retrying invalid AI question set (${attempts}/${maxAttempts}):`, error.message);
    }
  }
  if (generated.length < target) {
    throw new LlmQuestionGenerationError(
      `The AI generated only ${generated.length} of ${target} requested sets. Your current unfinished sets have been kept; refresh again to try another batch.`
    );
  }
  // Save the complete batch first. Only after the store verifies its write do
  // we commit anti-repeat memory, so discarded/failed batches never pollute it.
  const saved = replaceUncompletedIeltsQuestionSets(generated);
  commitGeneratedPlansMemory(saved.map(item => item.plan));
  return saved;
}
