import { IELTS_FREQUENT_QUESTIONS, type IeltsFrequentQuestionSeed } from '../data/ieltsFrequentQuestions';

const DECK_PREFIX = 'speakcoach_ielts_quality_v1.';
const TITLE_KEY = 'speakcoach_ielts_recent_cue_titles_v1';
const MAX_TITLES = 40;
const MAX_QUESTIONS = 80;
const MAX_PART1_TOPICS = 20;
const MAX_CUE_SUBJECTS = 40;

export const IELTS_PART1_FORMS = ['habit', 'past', 'preference', 'reason', 'comparison', 'change', 'hypothetical'] as const;
export const IELTS_PART3_FORMS = ['past vs present', 'causes', 'effects', 'evaluate', 'predict', 'government role', 'individual role', 'pros vs cons', 'solutions'] as const;
export const IELTS_PRONUNCIATION_FOCI = [
  'chunking and pausing', 'content-word stress', 'linking', 'weak forms',
  'list intonation', 'contrast intonation', 'collocation stress'
] as const;
export const IELTS_ANSWER_FEATURES = [
  'natural collocation', 'measured concession', 'careful hedging', 'clear linking'
] as const;
export const IELTS_BANNED_CLICHES = [
  'every coin has two sides', 'in this day and age', 'last but not least',
  'all in all', 'to be honest with you', 'it goes without saying',
  'at the end of the day', 'a blessing in disguise'
] as const;

export const CUE_CARD_SEEDS: Record<string, readonly string[]> = {
  person: [
    'a friend who introduced you to a new hobby','a teacher who made a difficult subject interesting','a relative who tells memorable stories',
    'a colleague who manages time effectively','a person who works in an unusual profession','someone who inspired you to learn a language',
    'a person you met while travelling','a neighbour with a useful practical skill','a public figure whose work you respect',
    'a friend who enjoys reading','someone who achieved a personal goal','a person from a different cultural background',
    'a family member who cooks well','a person who gave you helpful advice','a friend you knew during childhood'
  ],
  place: [
    'a historic city you would like to visit','a beach or coastal area','a mountain trail with a memorable view',
    'a public park with interesting features','a museum you enjoyed visiting','a quiet café where you can read',
    'a restaurant with memorable food','a bookshop you like','a train station in an unfamiliar city',
    'a village you visited on a trip','a sports centre you have used','a garden open to visitors',
    'a building with unusual architecture','a market you explored while travelling','a place with beautiful night views'
  ],
  object: [
    'a book that changed your opinion','a camera you use regularly','a bicycle you enjoy riding',
    'a musical instrument you would like to learn','an old photograph from your family','a gift with personal meaning',
    'a reusable water bottle you carry','a suitcase you use for travel','a recipe book you often consult',
    'a pair of headphones you rely on','a piece of handmade furniture','a board game you enjoy',
    'a watch you have owned for years','a toy you kept from childhood','an item you learned to maintain'
  ],
  event: [
    'a birthday celebration you remember','a graduation ceremony','a concert you attended',
    'a sports match you watched live','a wedding with an unusual tradition','a cultural festival',
    'a school trip from your childhood','a family meal for a special occasion','a trip delayed by unexpected weather',
    'a public celebration in your city','an art exhibition you visited','a competition you took part in',
    'your first day at a new job','a reunion with an old friend','a journey with an unexpected event'
  ],
  decision: [
    'choosing a field of study','deciding to buy a second-hand item','planning a trip with a limited budget',
    'changing to a different job','learning a practical skill','moving to a new city',
    'choosing a holiday destination','saving money for an important purchase','using public transport instead of a car',
    'joining a sports club','selecting a meaningful gift','deciding whether to study abroad',
    'changing a daily routine','accepting a challenging opportunity','choosing between two courses'
  ],
  skill: [
    'cooking a meal without following a recipe','riding a bicycle safely in traffic','taking photographs in natural light',
    'speaking a foreign language in conversation','managing a personal budget','speaking confidently to a group',
    'swimming a longer distance','growing herbs or vegetables','playing a musical instrument',
    'repairing or altering clothes','planning a multi-day trip','managing time during a busy week',
    'drawing a useful diagram','working effectively in a team','using a digital tool for creative work'
  ],
  activity: [
    'hiking in the countryside','camping with friends','cooking for your family','reading a novel',
    'visiting a museum independently','cycling through a city','playing a team sport','taking photographs outdoors',
    'exploring an unfamiliar city','attending a concert','learning a new language','gardening at home',
    'playing board games with friends','volunteering at a local event','travelling by train'
  ],
  'piece of media': [
    'a novel set in an unfamiliar country','a documentary about nature','a film about friendship',
    'a podcast that explains a scientific idea','a news article about technology','a travel blog you follow',
    'a music album connected to a memory','a photo essay about daily life','a historical television series',
    'a comedy show you enjoy','an educational video that taught you something','an interview with a creative professional',
    'an audiobook you listened to','an online tutorial for a practical skill','a short story with a surprising ending'
  ],
  situation: [
    'missing a train during a journey','losing luggage while travelling','unexpected rain during an outdoor activity',
    'planning a group holiday','helping a friend move house','cooking for guests with little preparation time',
    'finding a phone that you had misplaced','dealing with a noisy neighbour','resolving a disagreement with a colleague',
    'learning an unfamiliar route','changing travel plans at short notice','meeting new people at an event',
    'sharing accommodation with other people','buying the wrong size item online','finding a quiet place to study'
  ]
};

interface DeckState<T> { deck: T[]; cursor: number; cycle: number; clock?: number; lastUsed?: Record<string, number>; }
function shuffle<T>(values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* local variety is best effort */ } }
function deckKey(name: string): string { return DECK_PREFIX + name; }

export function takePersistedIeltsDeck<T>(name: string, values: readonly T[], count: number): T[] {
  const key = deckKey(name);
  const state = read<DeckState<T>>(key, { deck: [], cursor: 0, cycle: 0 });
  let deck = Array.isArray(state.deck) && state.deck.every(item => values.includes(item)) ? state.deck : [];
  let cursor = Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor <= deck.length ? state.cursor : 0;
  let cycle = Number.isInteger(state.cycle) ? state.cycle : 0;
  const result: T[] = [];
  while (result.length < count) {
    if (cursor >= deck.length) { deck = shuffle(values); cursor = 0; cycle++; }
    if (!deck.length) break;
    result.push(deck[cursor++]);
  }
  write(key, { deck, cursor, cycle });
  return result;
}

const TOPIC_SYNONYMS: Record<string, string[]> = {
  sustainability: ['environment','consumer choices','transport','housing','repair'],
  sustainable: ['environment','consumer choices','transport','housing','repair'],
  climate: ['environment','tourism','transport','outdoor activity'],
  nature: ['environment','outdoor activity','peaceful place'],
  design: ['creative work','project','cities','public spaces','useful object'],
  creativity: ['creative work','project','arts','useful object'],
  politics: ['public policy','government','work','community'],
  society: ['community','cities','culture','family'],
  technology: ['technology and society','useful invention','science'],
  transport: ['journey','travel','cities','public spaces'],
  travel: ['journey','tourism','place visited','outdoor activity'],
  learning: ['education','new skill','teacher','language learning'],
  education: ['education','teacher','new skill','language learning'],
  health: ['health','exercise','food','outdoor activity'],
  housing: ['housing','home','cities','public spaces'],
  work: ['work','project','work-life balance'],
  culture: ['culture','tradition','arts','performance'],
  community: ['public spaces','community event','event','volunteering']
};
function expandedTopicWords(value: string): Set<string> {
  const words = new Set(value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u).filter(word => word.length > 2));
  for (const [term, related] of Object.entries(TOPIC_SYNONYMS)) {
    if (words.has(term)) for (const phrase of related) for (const word of phrase.split(/\s+/u)) words.add(word);
  }
  return words;
}
export function weightedOrder<T extends { id: string; freq: number }>(items: readonly T[], lastUsed: Record<string, number>, clock: number): T[] {
  const scored = items.map(item => {
    const age = Math.max(0, clock - (lastUsed[item.id] ?? -1000));
    const weight = item.freq * (1 + Math.min(age, 100) / 30);
    const score = -Math.log(Math.max(Number.EPSILON, Math.random())) / weight;
    return { item, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.map(entry => entry.item);
}
export function takeWeightedQuestionSeeds(part: 1 | 2 | 3, count: number, requestedTopic = ''): IeltsFrequentQuestionSeed[] {
  const key = deckKey('questions-p' + part);
  const state = read<DeckState<string>>(key, { deck: [], cursor: 0, cycle: 0, lastUsed: {} });
  const pool = IELTS_FREQUENT_QUESTIONS.filter(item => item.part === part);
  const queryWords = expandedTopicWords(requestedTopic);
  const ranked = pool.map(item => {
    const topicTokens = item.topic.toLocaleLowerCase().split(/\s+/u);
    const questionTokens = item.question.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u);
    const score = topicTokens.filter(token => queryWords.has(token)).length * 2 +
      questionTokens.filter(token => queryWords.has(token)).length * 0.2;
    return { item, score };
  });
  const best = Math.max(0, ...ranked.map(entry => entry.score));
  const candidates = requestedTopic.trim() && best > 0
    ? ranked.filter(entry => entry.score >= best * 0.75).map(entry => entry.item)
    : pool;
  let deck = Array.isArray(state.deck) && state.deck.every(id => candidates.some(item => item.id === id)) ? state.deck : [];
  let cursor = Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor <= deck.length ? state.cursor : 0;
  let cycle = Number.isInteger(state.cycle) ? state.cycle : 0;
  let clock = Number.isInteger(state.clock) ? state.clock! : 0;
  const lastUsed = state.lastUsed && typeof state.lastUsed === 'object' ? state.lastUsed : {};
  const result: IeltsFrequentQuestionSeed[] = [];
  while (result.length < count) {
    if (cursor >= deck.length) { deck = weightedOrder(candidates, lastUsed, clock + 1).map(item => item.id); cursor = 0; cycle++; }
    const selected = candidates.find(item => item.id === deck[cursor++]);
    if (!selected) continue;
    result.push(selected);
    lastUsed[selected.id] = ++clock;
  }
  write(key, { deck, cursor, cycle, clock, lastUsed });
  return result;
}
export function nearestSeedTopics(topic: string, part: 1 | 2 | 3, count: number): IeltsFrequentQuestionSeed[] {
  const words = expandedTopicWords(topic);
  return IELTS_FREQUENT_QUESTIONS.filter(item => item.part === part).map(item => {
    const tokens = item.topic.toLocaleLowerCase().split(/\s+/u);
    const score = tokens.filter(token => words.has(token)).length * 2 +
      item.question.toLocaleLowerCase().split(/\s+/u).filter(token => words.has(token)).length * 0.2;
    return { item, score };
  }).sort((a, b) => b.score - a.score).slice(0, count).map(entry => entry.item);
}
export function getRecentCueCardTitles(): string[] { return read<string[]>(TITLE_KEY, []).slice(-MAX_TITLES); }
export function rememberCueCardTitles(titles: string[]): void {
  const merged = [...getRecentCueCardTitles(), ...titles.map(value => value.trim()).filter(Boolean)];
  write(TITLE_KEY, Array.from(new Map(merged.map(value => [value.toLocaleLowerCase(), value])).values()).slice(-MAX_TITLES));
}
export function getIeltsQualityMemorySnapshot(): Record<string, unknown> {
  const keys = ['part1-topics','part3-angles','part1-forms','part3-forms','cue-card-types','system-prompt-variants','questions-p1','questions-p2','questions-p3','shadowing-p1-grammar','shadowing-p2-grammar','shadowing-p3-grammar','shadowing-band-features','shadowing-pronunciation-focus','cue-subjects-person','cue-subjects-place','cue-subjects-object','cue-subjects-event','cue-subjects-decision','cue-subjects-skill','cue-subjects-activity','cue-subjects-piece of media' ,'cue-subjects-situation'];
  return { titles: getRecentCueCardTitles(), decks: Object.fromEntries(keys.map(name => [name, read(deckKey(name), null)])) };
}
export function restoreIeltsQualityMemorySnapshot(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object') return;
  const value = snapshot as { titles?: unknown; decks?: Record<string, unknown> };
  if (Array.isArray(value.titles)) write(TITLE_KEY, value.titles.filter(item => typeof item === 'string').slice(-MAX_TITLES));
  if (value.decks && typeof value.decks === 'object') for (const [name, state] of Object.entries(value.decks)) if (name.startsWith('part') || name.startsWith('cue-') || name.startsWith('questions-') || name.startsWith('shadowing-')) write(deckKey(name), state);
}
export const IELTS_MEMORY_LIMITS = { titles: MAX_TITLES, questions: MAX_QUESTIONS, part1Topics: MAX_PART1_TOPICS, cueSubjects: MAX_CUE_SUBJECTS };
