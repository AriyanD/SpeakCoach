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
import { markQuestionsSeen, markLlmTopicsSeen, markLlmQuestionsSeen, markLlmTitlesSeen, markLlmPart1TopicsSeen, getCompactLlmGenerationMemory, getRecentLlmPart1Topics } from './ieltsQuestionTracker';
import { CUE_CARD_SEEDS, IELTS_PART1_FORMS, IELTS_PART3_FORMS, takePersistedIeltsDeck } from './ieltsGenerationQuality';
import { sharedTextSimilarity, lemmatizedTokenJaccard } from './generationVariety';
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
  cueCardSubject?: string;
  part1Forms?: [string, string, string, string, string, string];
  part3Forms?: [string, string, string, string];
  part3Angles: [string, string];
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
const PART1_TOPIC_POOL = [
  'Accommodation','Art and drawing','Books and reading','Clothing and fashion','Daily routines','Dreams and ambitions','Exercise and sport','Family celebrations','Hometown','Work and study','Flowers and plants','Food markets','Giving and receiving gifts','Handwriting','Hobbies and collections','Home cooking','Keeping in touch','Local shops','Maps and directions','Museums and exhibitions','Names and naming','Neighbours','Outdoor activities','Photography','Public transport','Quiet places','Rainy weather','School memories','Science in daily life','Seasons','Shopping habits','Social occasions','Street markets','Team activities','The countryside','Time management','Traditional objects','Travel planning','Trees and green spaces','Using the internet','Volunteering','Walking','Weekend activities','Workplace routines','Learning practical skills','Libraries','Public parks','Languages','Music performances','Household chores','Childhood games','Local festivals','Bicycles','Public services','Making things by hand','Weather forecasts','Personal possessions','Community events','Healthy routines','Restaurants and cafés','Helping other people','Technology at home'
];
const GENERATION_ANGLE_POOL = ['community life','personal decisions','repair and reuse','work culture','public spaces','family expectations','practical learning','environmental habits','arts and culture','everyday technology','travel choices','food traditions','leisure','generational communication','consumer choices','social events','public wellbeing','creative problem-solving'];
const CUE_CARD_TYPES = Object.keys(CUE_CARD_SEEDS);
const PART3_ANGLE_POOL = ['changes across generations','causes','wider effects','public policy','community differences','economic pressures','environmental consequences','technology and society','education','shared responsibilities','future trade-offs','changing values'];
const PROMPT_VARIANTS = [
  'Write natural, varied questions. Obey the compact assignments and JSON schema exactly.',
  'Create idiomatic, distinct speaking questions. Follow every assigned topic, form and subject.',
  'Produce concise, realistic questions. Keep all assigned content and return only the specified JSON.'
];
function chooseFreshPart1Topics(recentPart1Topics: string[]): [string, string] {
  const excluded = new Set(recentPart1Topics.slice(-40).map(topic => topic.trim().toLocaleLowerCase()));
  const selected: string[] = [];
  for (let i = 0; i < PART1_TOPIC_POOL.length * 2 && selected.length < 2; i++) {
    const candidate = takePersistedIeltsDeck('part1-topics', PART1_TOPIC_POOL, 1)[0];
    if (candidate && !excluded.has(candidate.toLocaleLowerCase()) && !selected.includes(candidate)) selected.push(candidate);
  }
  return [selected[0] ?? PART1_TOPIC_POOL[0], selected[1] ?? PART1_TOPIC_POOL[1]];
}
export function createIeltsGenerationContext(excludedTopics: string[] = [], requestedTopic = '', recentPart1Topics: string[] = getRecentLlmPart1Topics()): IeltsGenerationContext {
  const cueCardType = requestedTopic.trim() ? 'user-selected theme' : takePersistedIeltsDeck('cue-card-types', CUE_CARD_TYPES, 1)[0];
  const cueCardSubject = requestedTopic.trim()
    ? requestedTopic.trim().slice(0, 72)
    : takePersistedIeltsDeck('cue-subjects-' + cueCardType, CUE_CARD_SEEDS[cueCardType], 1)[0];
  const angles = takePersistedIeltsDeck('part3-angles', PART3_ANGLE_POOL, 2);
  const p1Forms = takePersistedIeltsDeck('part1-forms', IELTS_PART1_FORMS, 6);
  const p3Forms = takePersistedIeltsDeck('part3-forms', IELTS_PART3_FORMS, 4);
  const randomPart = () => Math.random().toString(36).slice(2, 9);
  return {
    id: `ielts-gen-${Date.now().toString(36)}-${randomPart()}-${randomPart()}`,
    createdAt: new Date().toISOString(),
    preferredAngles: shuffled(GENERATION_ANGLE_POOL).slice(0, 5),
    part1Topics: chooseFreshPart1Topics([...excludedTopics.slice(-20), ...recentPart1Topics].slice(-40)),
    cueCardType,
    cueCardSubject,
    part1Forms: p1Forms as IeltsGenerationContext['part1Forms'],
    part3Forms: p3Forms as IeltsGenerationContext['part3Forms'],
    part3Angles: [angles[0], angles[1]]
  };
}
export function buildGeneratorPrompt(
  excludedTopics: string[],
  recentQuestions: string[] = [],
  requestedTopic = '',
  context: IeltsGenerationContext = createIeltsGenerationContext(excludedTopics, requestedTopic),
  recentTitles: string[] = [],
  retryGuidance = ''
): { system: string; user: string } {
  const p1Forms = context.part1Forms ?? ['habit','past','preference','reason','comparison','change'];
  const p3Forms = context.part3Forms ?? ['past vs present','causes','effects','evaluate'];
  const subject = context.cueCardSubject ?? context.cueCardType;
  const compactAvoid = (values: string[]) => Array.from(new Set(values.slice(-12).flatMap(value =>
    value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u)
      .filter(word => word.length > 3 && !['which','where','would','could','about','people','their','there','should'].includes(word)).slice(0, 1)
  ))).slice(-12).join(', ');
  const avoid = compactAvoid([...recentTitles.slice(-6), ...recentQuestions.slice(-6)]);
  const topicAvoid = excludedTopics.slice(-12).join(', ');
  const requested = requestedTopic.trim() ? requestedTopic.trim().slice(0, 72) : subject;
  const variant = takePersistedIeltsDeck('system-prompt-variants', PROMPT_VARIANTS, 1)[0];
  const themeLine = requestedTopic.trim()
    ? `USER-SELECTED THEME FOR PARTS 2 & 3: "${requestedTopic.trim().slice(0, 72)}". Do not force this theme into Part 1.`
    : `CREATIVE DIVERSITY LENSES: ${context.preferredAngles.join('; ')}. Use one as inspiration for the concrete Part 2 subject.`;
  const system = `${variant} Do not claim this is official or from a real exam.
ASSIGN: Part 1 topic A: "${context.part1Topics[0]}"; Part 1 topic B: "${context.part1Topics[1]}". Part 1 forms in order: ${p1Forms.join(', ')}.
Part 2: cue-card type: ${context.cueCardType}; concrete subject: ${requested}.
Part 3 angles: ${context.part3Angles.join(' / ')}; Part 3 forms in order: ${p3Forms.join(', ')}.
${themeLine}
Recent topics already used (keywords): ${topicAvoid || 'none'}.
Recent questions and cue-card titles (keywords only): ${avoid || 'none'}.
RULES: Part 1 exactly 6 questions, 3 per assigned topic; follow each assigned form and use distinct openings within the part. Part 2 one concrete Describe cue card with exactly four useful bullets. Part 3 exactly 4 distinct discussion questions rooted in the Part 2 cue card’s underlying theme. Broaden from the candidate’s personal experience to wider social, cultural, economic, environmental, educational or policy implications. Do not switch to an unrelated subject or repeat the cue-card bullets. Use assigned angles and forms for varied perspectives within that shared theme; keep topic labels on the same broad theme or closely related facets. Avoid semantic repeats and clichés. Avoid close semantic equivalents, not merely identical wording. Keep spoken questions concise and accessible.
JSON ONLY: {"part1Topics":["A","B"],"part1Questions":[{"topic":"A","question":"..."},{"topic":"A","question":"..."},{"topic":"A","question":"..."},{"topic":"B","question":"..."},{"topic":"B","question":"..."},{"topic":"B","question":"..."}],"part2CueCard":{"topic":"...","title":"...","prompt":"Describe ...","bullets":["...","...","...","..."]},"part3Questions":[{"topic":"...","question":"..."},{"topic":"...","question":"..."},{"topic":"...","question":"..."},{"topic":"...","question":"..."}]}`;
  const baseUser = 'Generate one complete IELTS Speaking test set. Follow every assignment and return only the requested JSON.';
  const user = retryGuidance
    ? `${baseUser} IMPORTANT CORRECTION: ${retryGuidance}`
    : baseUser;
  return { system, user };
}
function normalizeGenerationText(value: string): string {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const TOPIC_STOP_WORDS = new Set(['a', 'an', 'and', 'about', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'your', 'my', 'our', 'their', 'topic']);

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

export function hasRecentQuestionOverlap(question: string, recentQuestions: string[], isTitle = false): boolean {
  const normalized = normalizeGenerationText(question);
  if (!normalized) return false;
  for (const recent of recentQuestions) {
    if (normalized === normalizeGenerationText(recent)) return true;
    if (isTitle ? lemmatizedTokenJaccard(question, recent) >= 0.55 : sharedTextSimilarity(question, recent, 'en') >= 0.68) return true;
  }
  return false;
}

function getPlanGenerationMemory(plan: IeltsTestSessionPlan): { topics: string[]; questions: string[]; titles: string[]; part1Topics: string[] } {
  return {
    topics: Array.from(new Set([
      ...plan.part1Questions.map(question => question.topic),
      plan.part2CueCard.topic,
      ...plan.part3Questions.map(question => question.topic)
    ])),
    questions: [
      ...plan.part1Questions.map(question => question.question),
      ...plan.part3Questions.map(question => question.question)
    ],
    titles: [plan.part2CueCard.title],
    part1Topics: [...plan.part1Topics]
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
  markLlmTitlesSeen(memory.flatMap(item => item.titles));
  markLlmPart1TopicsSeen(memory.flatMap(item => item.part1Topics));
}

export function parseLlmSessionPlanResponse(rawText: string, options: {
  generationContext?: IeltsGenerationContext;
  recentQuestions?: string[];
  recentTitles?: string[];
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

  if (options.generationContext?.cueCardType === 'user-selected theme' && options.generationContext.cueCardSubject && sharedTextSimilarity(`${p2Title} ${p2Prompt} ${rawBullets.join(' ')}`, options.generationContext.cueCardSubject, 'en') < 0.18) {
    throw new Error(`Part 2 cue card did not sufficiently reflect its assigned subject: ${options.generationContext.cueCardSubject}.`);
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

  // Part 3 must stay anchored to the Part 2 cue card while broadening the
  // discussion. Check the question + topic label together so wider, related
  // angles (e.g. a favourite park -> public space policy) remain valid.
  const cueCardAnchor = [p2Topic, p2Title, p2Prompt, ...bullets].join(' ');
  const relatedPart3Count = part3Questions.filter(question =>
    sharedTextSimilarity(`${question.topic} ${question.question}`, cueCardAnchor, 'en') >= 0.12
  ).length;
  if (relatedPart3Count < 3) {
    throw new Error('Part 3 questions must remain connected to the Part 2 cue-card theme while discussing its wider implications.');
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
  const recentTitles = options.recentTitles ?? [];
  const recentOverlap = [
    ...part1Questions.map(question => question.question),
    ...part3Questions.map(question => question.question)
  ].find(question => hasRecentQuestionOverlap(question, recentQuestions))
    ?? (hasRecentQuestionOverlap(part2CueCard.title, recentTitles, true) ? part2CueCard.title : undefined);
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
  generationMemory?: { topics: string[]; questions: string[]; titles?: string[]; part1Topics?: string[] };
  strictValidation?: boolean;
  deferMemoryCommit?: boolean;
  retryGuidance?: string;
}): Promise<IeltsTestSessionPlan> {
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl);
  // Only AI-generated topic/question memory is used. The retired built-in
  // question bank is deliberately not imported into the production generator.
  const compactMemory = params.generationMemory ?? getCompactLlmGenerationMemory();
  const excludedTopics = compactMemory.topics;
  const generationContext = params.generationContext ?? createIeltsGenerationContext(excludedTopics, params.requestedTopic ?? '', getRecentLlmPart1Topics());
  const prompt = buildGeneratorPrompt(excludedTopics, compactMemory.questions, params.requestedTopic ?? '', generationContext, compactMemory.titles ?? [], params.retryGuidance ?? '');
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
    recentTitles: params.strictValidation ? (compactMemory.titles ?? []) : [],
    persistMemory: !params.deferMemoryCommit
  });
}

function getQuestionSetRetryGuidance(message: string): string {
  if (/Part 2 cue card did not sufficiently reflect its assigned subject/i.test(message)) {
    return 'Make the Part 2 title, prompt and all four bullets clearly about the assigned concrete subject; do not replace it with a merely related idea.';
  }
  if (/Part 3 questions must remain connected/i.test(message)) {
    return 'Keep at least three Part 3 questions visibly anchored to the same Part 2 cue-card theme while exploring wider social implications.';
  }
  if (/repeats or closely paraphrases|duplicate question wording/i.test(message)) {
    return 'Use genuinely different question ideas and examples; do not reuse or lightly reword questions from earlier sets.';
  }
  if (/topic mismatch|Part 1 must contain exactly two/i.test(message)) {
    return 'Use exactly the two assigned Part 1 topic labels and provide three distinct questions under each topic.';
  }
  if (/parse LLM question JSON|empty response|missing valid part/i.test(message)) {
    return 'Return one complete, compact, valid JSON object only; include every required array and field, with no prose or code fences.';
  }
  return 'Return one complete set that follows every assigned topic, question count, cue-card subject, and JSON field exactly.';
}

export async function generateIeltsPlanWithTierFallback(options?: {
  mode?: IeltsTestMode;
  transport?: (opts: any) => Promise<any>;
  /** @deprecated Kept for compatibility; built-in IELTS question fallback is retired. */
  allowBuiltinFallback?: boolean;
  requestedTopic?: string;
  generationContext?: IeltsGenerationContext;
  generationMemory?: { topics: string[]; questions: string[]; titles?: string[]; part1Topics?: string[] };
  strictValidation?: boolean;
  deferMemoryCommit?: boolean;
  retryGuidance?: string;
}): Promise<LlmQuestionPlanResult> {
  let fallbackReason: string | undefined;
  let configuredProviderName: string | undefined;
  let configuredModelName: string | undefined;
  const generationMemory: { topics: string[]; questions: string[]; titles?: string[]; part1Topics?: string[] } = options?.generationMemory ?? getCompactLlmGenerationMemory();
  const generationContext = options?.generationContext ?? createIeltsGenerationContext(generationMemory.topics, options?.requestedTopic ?? '', generationMemory.part1Topics ?? getRecentLlmPart1Topics());
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
          deferMemoryCommit: true,
          retryGuidance: options?.retryGuidance
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
  const batchTitles: string[] = [];
  const batchPart1Topics: string[] = [];
  let attempts = 0;
  let retryGuidance = '';
  let lastRetryReason = '';
  const maxAttempts = target + 5;

  while (generated.length < target && attempts < maxAttempts) {
    attempts++;
    const generationMemory = {
      topics: [...baseMemory.topics, ...batchTopics].slice(-40),
      questions: [...baseMemory.questions, ...batchQuestions].slice(-24),
      titles: [...(baseMemory.titles ?? []), ...batchTitles].slice(-24),
      part1Topics: [...getRecentLlmPart1Topics(), ...batchPart1Topics].slice(-40)
    };
    const generationContext = createIeltsGenerationContext(generationMemory.topics, options?.requestedTopic ?? '', generationMemory.part1Topics ?? getRecentLlmPart1Topics());
    try {
      const result = await generateIeltsPlanWithTierFallback({
        transport: options?.transport,
        requestedTopic: options?.requestedTopic,
        allowBuiltinFallback: false,
        generationContext,
        generationMemory,
        strictValidation: true,
        deferMemoryCommit: true,
        retryGuidance
      });
      if (result.source !== 'online_ai' || !result.plan.id.includes('llm')) {
        throw new LlmQuestionGenerationError(
          'IELTS question library accepts AI-generated sets only. Built-in question bank results are not added.',
          result.providerName,
          result.modelName
        );
      }
      retryGuidance = '';
      lastRetryReason = '';
      generated.push({
        plan: result.plan,
        providerName: result.providerName,
        modelName: result.modelName
      });
      const planMemory = getPlanGenerationMemory(result.plan);
      batchTopics.push(...planMemory.topics);
      batchQuestions.push(...planMemory.questions);
      batchTitles.push(...planMemory.titles);
      batchPart1Topics.push(...planMemory.part1Topics);
    } catch (error) {
      if (!(error instanceof LlmQuestionGenerationError) || !error.retryable) throw error;
      if (attempts >= maxAttempts) break;
      lastRetryReason = error.message.replace(/\\s+/gu, ' ').slice(0, 240);
      retryGuidance = getQuestionSetRetryGuidance(error.message);
      console.warn(`[ieltsQuestionGenerator] Retrying invalid AI question set (${attempts}/${maxAttempts}):`, error.message);
    }
  }
  if (generated.length < target) {
    throw new LlmQuestionGenerationError(
      `The AI generated only ${generated.length} of ${target} requested sets after ${attempts} attempts. Last issue: ${lastRetryReason || 'The provider could not complete a valid set.'} Your current unfinished sets have been kept; refresh again to try another batch.`
    );
  }
  // Save the complete batch first. Only after the store verifies its write do
  // we commit anti-repeat memory, so discarded/failed batches never pollute it.
  const saved = replaceUncompletedIeltsQuestionSets(generated);
  commitGeneratedPlansMemory(saved.map(item => item.plan));
  return saved;
}
