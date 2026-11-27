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
  person: ['a neighbour who shared a practical skill','a colleague who handled a difficult situation calmly','a relative who changed their career later in life','a friend who organised a community activity','a local craftsperson whose work you admire','a person who encouraged you to question an idea','a volunteer who supported a local project','a teacher who made a complex subject accessible','a friend with an unusual hobby','a person who repaired something instead of replacing it','a community organiser you once met','a relative with a memorable daily routine','a person who helped you settle into a new place','a colleague who solved a problem creatively','someone whose advice changed a decision'],
  place: ['a public library with a welcoming atmosphere','a walking route beside water','a small workshop open to visitors','a neighbourhood market','a quiet courtyard in a busy area','a community garden','a building with an unusual design','a place where people gather outdoors','a museum focused on everyday life','a café suitable for working quietly','a coastal path','a public square used for events','a place you visited during bad weather','a green space in a city','a local place that has changed over time'],
  object: ['a tool used for a practical repair','a notebook that helped organise a project','a second-hand object with an interesting history','a reusable item that replaced disposable products','a piece of furniture made by hand','a device that saves time at home','a photograph with personal meaning','an object inherited from a relative','a useful item bought from a local maker','a map kept from a memorable journey','a musical instrument you tried','a small object that is difficult to replace','a household item designed unusually well','a book with notes written by someone else','an item you learned to maintain'],
  event: ['a neighbourhood event organised by residents','a workshop where strangers worked together','a small celebration after a shared achievement','a public talk that changed your perspective','a local festival affected by the weather','a community clean-up day','a performance in an unexpected venue','a family gathering with a new tradition','a sports event watched with friends','a meeting where a disagreement was resolved','an exhibition by local artists','a volunteer event with practical results','a trip delayed by an unexpected event','a school event remembered for teamwork','a public event that brought generations together'],
  decision: ['choosing a field of study','deciding to move to a different neighbourhood','turning down an attractive opportunity','changing a daily habit for environmental reasons','choosing to learn a practical skill','deciding to work with a new team','buying a repaired or second-hand item','changing the way you travel','taking responsibility for a group task','choosing a smaller but more meaningful project','deciding to continue learning after graduation','changing a long-term plan','choosing where to spend a holiday','deciding to speak up in a meeting','choosing a more affordable option'],
  skill: ['repairing a household item','preparing a meal without a recipe','speaking confidently to a group','planning a low-cost trip','using a digital tool for creative work','growing herbs or vegetables','taking clear photographs','making a simple piece of furniture','managing time during a busy week','learning to cycle in traffic','drawing a useful diagram','giving constructive feedback','organising a community activity','maintaining a bicycle','learning a new language through conversation'],
  activity: ['walking through an unfamiliar part of a city','camping with a small group','visiting a local market','making something with your hands','volunteering at a community event','cycling along a safe route','cooking a meal with friends','exploring a museum independently','working on a shared garden','attending a public lecture','taking photographs outdoors','learning a dance or movement activity','repairing or upcycling an object','planning a day without a car','playing a team game'],
  'piece of media': ['a documentary about everyday consumption','a podcast that explained a social issue','a novel set in an unfamiliar community','an article about redesigning public spaces','a film with an unexpected ending','a radio programme about local history','a photograph that tells a social story','a series about people changing careers','a book exploring a different culture','a short video teaching a practical skill','a story about cooperation','a news feature that raised a question','a song connected with a personal memory','an interview with a creative professional','a programme about protecting local nature'],
  situation: ['helping a visitor who had lost their way','solving a misunderstanding in a group','finding an alternative after a service was cancelled','working with limited materials','making a plan during unexpected rain','returning an item that was not as described','sharing a workspace with others','adjusting a routine after a timetable change','dealing with a delayed delivery','finding a quiet place to concentrate','organising transport for a group','asking for help with an unfamiliar task','making a fair decision with limited time','adapting an event for different needs','finding a practical use for discarded materials']
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
