import { Preferences } from '@capacitor/preferences';
import type { ShadowingDifficulty } from '../data/shadowingBank';
import { SHADOWING_LANGUAGES } from '../data/shadowingLanguages';
import type { ShadowingLanguageCode } from '../data/shadowingLanguages';

export interface VarietySlot {
  situation: string;
  speechAct: string;
  grammar: string;
  length: string;
  focus: string;
  promptVariantId: string;
}
export interface VarietyMemoryEntry { openingKey: string; keyWords: string[]; text: string; }

const VERSION = 1;
const MEMORY_LIMIT = 120;
const situations = [
  'late train','shared kitchen','noisy neighbour','weekend plan','lost parcel','busy café','colleague','appointment','local market','broken device',
  'short commute','sudden rain','group chat','quiet library','family visit','walking route','crowded bus','borrowed item','local event','useful app',
  'late delivery','work handover','study deadline','table booking','home repair','travel link','small purchase','public notice','team decision','free afternoon',
  'phone call','morning habit','shared office','cancelled plan','stranger help','local project','lost password','packed bag','customer ask','busy street',
  'class talk','weekend market','new schedule','short break','lost receipt','local service','garden task','public meeting','new recipe','train platform',
  'missed message','borrowed book','comparison','new discovery','useful tip','small hassle','personal choice','future plan','small win','familiar place'
];
const speechActs = ['observation','request','explanation','reaction','plan','comparison','suggestion','question','preference','concession','reminder','decision'];
const grammarFrames: Record<ShadowingDifficulty, string[]> = {
  easy: ['simple present','simple past','future plan','can/could request','basic question','because clause','there is/are','comparison','imperative','time clause'],
  medium: ['relative clause','present perfect','reported thought','conditional','contrast clause','phrasal verb','cause and effect','modal deduction','comparison clause','time sequence'],
  hard: ['mixed conditional','concession clause','inversion','embedded question','precise passive','modal perfect','subordinate clause','qualified claim','contrastive emphasis','complex comparison'],
  ielts: ['reason plus example','concession plus view','past-to-present link','qualified opinion','hypothetical reflection','comparison with reason','personal anecdote','cause and consequence','balanced judgement','future implication']
};
export const SHADOWING_LENGTH_BANDS: Record<ShadowingDifficulty, { min: number; max: number }> = {
  easy: { min: 8, max: 16 },
  medium: { min: 12, max: 22 },
  hard: { min: 14, max: 28 },
  ielts: { min: 18, max: 30 }
};
export function getShadowingLengthBandLabel(level: ShadowingDifficulty): string {
  const { min, max } = SHADOWING_LENGTH_BANDS[level];
  return `${min}-${max}w`;
}
const promptVariants = [
  { id: 'v1', wording: 'Write natural speech; follow every slot.' },
  { id: 'v2', wording: 'Use idiomatic speech; follow every slot.' },
  { id: 'v3', wording: 'Write realistic speech; follow every row.' },
  { id: 'v4', wording: 'Use everyday speech; keep each slot.' }
];
const key = (kind: string, language: string, level: string) => `speakcoach_generation_variety_v${VERSION}.${kind}.${language}.${level}`;

async function readJson<T>(storageKey: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key: storageKey });
    if (value) return JSON.parse(value) as T;
  } catch { /* localStorage fallback */ }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}
async function writeJson(storageKey: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  try { await Preferences.set({ key: storageKey, value: serialized }); } catch { /* browser fallback */ }
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, serialized); } catch { /* storage may be unavailable */ }
}
function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
async function takeDeck<T>(name: string, values: readonly T[], count: number, language: string, level: string): Promise<T[]> {
  const storageKey = key(name, language, level);
  const state = await readJson<{ deck: T[]; cursor: number }>(storageKey, { deck: [], cursor: 0 });
  let deck = Array.isArray(state.deck) && state.deck.every(item => values.includes(item)) ? state.deck : [];
  let cursor = Number.isInteger(state.cursor) && state.cursor >= 0 && state.cursor <= deck.length ? state.cursor : 0;
  const result: T[] = [];
  while (result.length < count) {
    if (cursor >= deck.length) { deck = shuffle(values); cursor = 0; }
    if (!deck.length) break;
    result.push(deck[cursor++]);
  }
  await writeJson(storageKey, { deck, cursor });
  return result;
}
export async function buildVarietySlots(language: ShadowingLanguageCode, level: ShadowingDifficulty, count: number, foci: readonly string[]): Promise<{ slots: VarietySlot[]; promptVariantId: string }> {
  const safeCount = Math.max(1, Math.min(22, count));
  const [scenarioRows, acts, grammar, focusRows, variants] = await Promise.all([
    takeDeck('situations', situations, safeCount, language, level),
    takeDeck('acts', speechActs, safeCount, language, level),
    takeDeck('grammar', grammarFrames[level], safeCount, language, level),
    takeDeck('foci', foci, safeCount, language, level),
    takeDeck('prompt', promptVariants, 1, language, level)
  ]);
  const slots = scenarioRows.map((situation, i) => ({
    situation, speechAct: acts[i], grammar: grammar[i], length: getShadowingLengthBandLabel(level),
    focus: focusRows[i], promptVariantId: variants[0].id
  }));
  return { slots, promptVariantId: variants[0].id };
}

const SHADOWING_STOP_WORDS = new Set(['the','and','for','with','that','this','from','have','your','about','when','what','there','their','would','could','should','into','because','just','then','than','very','really','من','برای','که','این','آن','با','از','به','در','را','و','می','های','och','att','det','som','en','ett','jag','är','på','till','med','den','der','die','das','und','ist','zu','im','am','ein','eine','ich','wir','mit','für','auf','von','le','la','les','de','des','du','et','est','un','une','je','tu','il','elle','nous','vous','avec','dans','sur','el','los','las','del','y','es','una','yo','que','con','para','por','mi','il','lo','gli','di','e','è','io','per','in','su','het','een','van','ik','je','hij','zij','o','a','os','as','do','da','um','uma','eu','em','и','в','на','с','что','я','он','она','это','не','для','к','по','из','как','ve','bir','bu','şu','için','ile','de','da','ben','o','و','في','من','على','إلى','أن','هو','هي','هذا','هذه','مع','عن']);
const SIMILARITY_CACHE_LIMIT = 400;
const SIMILARITY_MEMORY_LIMIT = 120;
export const VARIETY_MEMORY_TIER_BOUNDARY = 40;
export const VARIETY_RECENT_SIMILARITY_THRESHOLD = 0.5;
export const VARIETY_OLDER_SIMILARITY_THRESHOLD = 0.65;
type SimilaritySets = { grams: Set<string>; tokens: Set<string> };
const similarityCache = new Map<string, SimilaritySets>();

function compactWords(text: string, language: string): string[] {
  const clean = text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = clean.split(/\s+/u).filter(word => word.length > 2);
  if (language === 'zh' || language === 'ja') return Array.from(clean.replace(/\s+/g, '')).filter(ch => /[\p{L}\p{N}]/u.test(ch)).slice(1, 5);
  return words.filter(word => !SHADOWING_STOP_WORDS.has(word)).slice(0, 4);
}
export function openingKey(text: string, language: string): string {
  const clean = text.normalize('NFKC').toLocaleLowerCase().replace(/^[\p{P}\p{S}\s]+/u, '');
  if (language === 'zh' || language === 'ja') return Array.from(clean.replace(/\s+/g, '')).slice(0, 3).join('');
  return clean.split(/\s+/u).slice(0, 2).join(' ');
}
function grams(text: string): Set<string> {
  const chars = Array.from(text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''));
  const result = new Set<string>();
  for (let i = 0; i <= chars.length - 3; i++) result.add(chars.slice(i, i + 3).join(''));
  return result;
}
function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
function normalizedSimilarityText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function createContentTokens(normalized: string, language: string): Set<string> {
  if (language === 'zh' || language === 'ja') {
    const characters = Array.from(normalized.replace(/\s+/gu, ''));
    const bigrams = new Set<string>();
    for (let index = 0; index < characters.length - 1; index++) bigrams.add(characters.slice(index, index + 2).join(''));
    return bigrams;
  }
  return new Set(normalized.split(/\s+/u).filter(Boolean).map(lemmaToken)
    .filter(token => token.length > 2 && !SHADOWING_STOP_WORDS.has(token)));
}
function getSimilaritySets(text: string, language: string): SimilaritySets {
  const normalized = normalizedSimilarityText(text);
  const cacheKey = `${language}:${normalized}`;
  const cached = similarityCache.get(cacheKey);
  if (cached) {
    similarityCache.delete(cacheKey);
    similarityCache.set(cacheKey, cached);
    return cached;
  }
  const sets = { grams: grams(normalized), tokens: createContentTokens(normalized, language) };
  similarityCache.set(cacheKey, sets);
  if (similarityCache.size > SIMILARITY_CACHE_LIMIT) {
    const oldest = similarityCache.keys().next().value;
    if (oldest !== undefined) similarityCache.delete(oldest);
  }
  return sets;
}
export function contentTokens(text: string, language: string): Set<string> {
  return getSimilaritySets(text, language).tokens;
}
export function sentenceSimilarity(a: string, b: string, language: string): number {
  const setsA = getSimilaritySets(a, language);
  const setsB = getSimilaritySets(b, language);
  return Math.max(jaccard(setsA.grams, setsB.grams), jaccard(setsA.tokens, setsB.tokens));
}
const TITLE_STOP_WORDS = new Set(['a','an','and','at','by','for','from','in','of','on','the','to','with','about']);
export function lemmaToken(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 5 && ['ches','shes','xes','zes','sses'].some(suffix => token.endsWith(suffix))) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}
export function lemmatizedTokenJaccard(a: string, b: string): number {
  const tokens = (value: string) => new Set(value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/u).map(lemmaToken).filter(token => token.length > 2 && !TITLE_STOP_WORDS.has(token)));
  return jaccard(tokens(a), tokens(b));
}
export function sharedTextSimilarity(a: string, b: string, language = 'en'): number {
  // Keep the established IELTS/topic-overlap metric stable; sentenceSimilarity is
  // intentionally the richer Shadowing-specific metric.
  const char = jaccard(grams(a), grams(b));
  const tokensA = new Set(compactWords(a, language));
  const tokensB = new Set(compactWords(b, language));
  return Math.max(char, jaccard(tokensA, tokensB), lemmatizedTokenJaccard(a, b));
}
export function makeMemoryEntry(text: string, language: string): VarietyMemoryEntry {
  return { openingKey: openingKey(text, language), keyWords: compactWords(text, language), text: text.replace(/\s+/g, ' ').trim() };
}
export async function getVarietyMemory(language: ShadowingLanguageCode, level: ShadowingDifficulty): Promise<VarietyMemoryEntry[]> {
  const current = await readJson<VarietyMemoryEntry[]>(key('memory', language, level), []);
  const validCurrent = Array.isArray(current) ? current.filter(item =>
    !!item && typeof item.text === 'string' && typeof item.openingKey === 'string' &&
    Array.isArray(item.keyWords) && item.keyWords.every(word => typeof word === 'string')
  ).slice(-MEMORY_LIMIT) : [];
  if (validCurrent.length) return validCurrent;
  const legacyKeys = language === 'en'
    ? ['speakcoach_shadowing_recent_sentences_v1', 'speakcoach_shadowing_recent_sentences_v2.en']
    : [`speakcoach_shadowing_recent_sentences_v2.${language}`];
  const migrated: VarietyMemoryEntry[] = [];
  for (const legacyKey of legacyKeys) {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(legacyKey) : null;
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) for (const text of parsed) if (typeof text === 'string') migrated.push(makeMemoryEntry(text, language));
    } catch { /* ignore malformed legacy memory */ }
  }
  const memory = migrated.slice(-MEMORY_LIMIT);
  if (memory.length) await writeJson(key('memory', language, level), memory);
  return memory;
}
export async function seedVarietyMemory(language: ShadowingLanguageCode, level: ShadowingDifficulty, texts: string[]): Promise<void> {
  if (!texts.length) return;
  const current = await getVarietyMemory(language, level);
  const merged = [...current, ...texts.map(text => makeMemoryEntry(text, language)).filter(item => item.text.length > 0)];
  const deduped = Array.from(new Map(merged.map(item => [item.text.toLocaleLowerCase(), item])).values());
  await writeJson(key('memory', language, level), deduped.slice(-MEMORY_LIMIT));
}
export async function rememberVarietySentences(language: ShadowingLanguageCode, level: ShadowingDifficulty, texts: string[]): Promise<void> {
  await seedVarietyMemory(language, level, texts);
}
export function validateVarietyBatch(
  texts: string[], language: ShadowingLanguageCode, memory: VarietyMemoryEntry[],
  threshold = VARIETY_RECENT_SIMILARITY_THRESHOLD, priorOpenings: string[] = [], priorTexts: string[] = []
): { accepted: number[]; rejected: Array<{ index: number; reason: string }> } {
  const accepted: number[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  const boundedMemory = memory.slice(-SIMILARITY_MEMORY_LIMIT);
  const recentMemory = boundedMemory.slice(-VARIETY_MEMORY_TIER_BOUNDARY);
  const olderMemory = boundedMemory.slice(0, -VARIETY_MEMORY_TIER_BOUNDARY);
  const openingCounts = new Map<string, number>();
  for (const opening of priorOpenings) openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const opening = openingKey(text, language);
    if (!opening || (openingCounts.get(opening) ?? 0) >= 2) { rejected.push({ index: i, reason: 'opening' }); continue; }
    const tooSimilar = recentMemory.some(item => sentenceSimilarity(text, item.text, language) >= threshold) ||
      olderMemory.some(item => sentenceSimilarity(text, item.text, language) >= VARIETY_OLDER_SIMILARITY_THRESHOLD) ||
      priorTexts.some(item => sentenceSimilarity(text, item, language) >= threshold) ||
      accepted.some(index => sentenceSimilarity(text, texts[index], language) >= threshold);
    if (tooSimilar) { rejected.push({ index: i, reason: 'similar' }); continue; }
    openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
    accepted.push(i);
  }
  return { accepted, rejected };
}
export function getPromptVariantLine(id: string): string {
  return promptVariants.find(item => item.id === id)?.wording ?? promptVariants[0].wording;
}

export async function exportGenerationVarietySnapshot(): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = { version: VERSION, memory: {} };
  const memory = snapshot.memory as Record<string, unknown>;
  for (const language of SHADOWING_LANGUAGES) for (const level of ['easy','medium','hard','ielts'] as const) {
    memory[`${language.code}:${level}`] = await getVarietyMemory(language.code, level);
  }
  return snapshot;
}
export async function importGenerationVarietySnapshot(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const snapshot = value as { memory?: Record<string, unknown>; decks?: Record<string, unknown> };
  for (const language of SHADOWING_LANGUAGES) for (const level of ['easy','medium','hard','ielts'] as const) {
    const id = `${language.code}:${level}`;
    const entries = snapshot.memory?.[id];
    if (Array.isArray(entries)) {
      const safe = entries.filter((item): item is VarietyMemoryEntry =>
        !!item && typeof item === 'object' && typeof (item as VarietyMemoryEntry).text === 'string' &&
        typeof (item as VarietyMemoryEntry).openingKey === 'string' && Array.isArray((item as VarietyMemoryEntry).keyWords)
      ).slice(-MEMORY_LIMIT);
      await writeJson(key('memory', language.code, level), safe);
    }
    const decks = snapshot.decks?.[id];
    if (decks && typeof decks === 'object' && !Array.isArray(decks)) {
      for (const kind of ['situations','acts','grammar','foci','prompt']) {
        const state = (decks as Record<string, unknown>)[kind] as { deck?: unknown[]; cursor?: number } | undefined;
        if (state && Array.isArray(state.deck) && Number.isInteger(state.cursor)) {
          await writeJson(key(kind, language.code, level), { deck: state.deck, cursor: Math.max(0, Math.min(state.deck.length, Number(state.cursor))) });
        }
      }
    }
  }
}
