import { countShadowingLanguageUnits } from '../data/shadowingLanguages';
import type { ShadowingSentence } from '../data/shadowingBank';
import { takePersistedIeltsDeck, takeWeightedQuestionSeeds, IELTS_ANSWER_FEATURES, IELTS_BANNED_CLICHES, IELTS_PRONUNCIATION_FOCI } from './ieltsGenerationQuality';
import { openingKey, sentenceSimilarity, type VarietyMemoryEntry } from './generationVariety';

export type IeltsAnswerFunction = 'A' | 'R' | 'E' | 'W';
export interface IeltsShadowingSlot {
  q: number;
  fn: IeltsAnswerFunction;
  part: 1 | 2 | 3;
  seedId: string;
  question: string;
  topic: string;
  grammar: string;
  bandFeature: string;
  focus: string;
}
export interface IeltsShadowingCandidate { q: number; fn: IeltsAnswerFunction; text: string; chunk: string; }
const P1_FUNCTIONS: IeltsAnswerFunction[] = ['A','R'];
const P2_FUNCTIONS: IeltsAnswerFunction[] = ['A','R','E','E','E','W'];
const P3_FUNCTIONS: IeltsAnswerFunction[] = ['A','R','E','W'];
const P2_GRAMMAR = ['past simple','past perfect','present perfect','used to/would'];
const P3_GRAMMAR = ['conditionals','modals of possibility','comparatives','passive'];
const P1_GRAMMAR = ['present simple','past simple','present perfect','preference comparison'];
const FUNCTION_LABEL: Record<IeltsAnswerFunction, string> = {
  A: 'direct answer or viewpoint', R: 'reason', E: 'specific example or detail', W: 'measured concession or reflection'
};

function makeSlots(requestedTopic: string): IeltsShadowingSlot[] {
  const p1 = takeWeightedQuestionSeeds(1, 3);
  const p2 = takeWeightedQuestionSeeds(2, 1, requestedTopic);
  const p3 = takeWeightedQuestionSeeds(3, 2, requestedTopic);
  const grammar1 = takePersistedIeltsDeck('shadowing-p1-grammar', P1_GRAMMAR, 6);
  const grammar2 = takePersistedIeltsDeck('shadowing-p2-grammar', P2_GRAMMAR, 6);
  const grammar3 = takePersistedIeltsDeck('shadowing-p3-grammar', P3_GRAMMAR, 8);
  const bands = takePersistedIeltsDeck('shadowing-band-features', IELTS_ANSWER_FEATURES, 20);
  const foci = takePersistedIeltsDeck('shadowing-pronunciation-focus', IELTS_PRONUNCIATION_FOCI, 20);
  const slots: IeltsShadowingSlot[] = [];
  let cursor = 0;
  const add = (seed: typeof p1[number], q: number, part: 1 | 2 | 3, functions: IeltsAnswerFunction[], grammar: string[]) => {
    for (let i = 0; i < functions.length; i++) {
      slots.push({
        q, fn: functions[i], part, seedId: seed.id, question: seed.question, topic: seed.topic,
        grammar: grammar[cursor % grammar.length],
        bandFeature: bands[cursor], focus: foci[cursor]
      });
      cursor++;
    }
  };
  p1.forEach((seed, index) => add(seed, index, 1, P1_FUNCTIONS, grammar1));
  add(p2[0], 3, 2, P2_FUNCTIONS, grammar2);
  p3.forEach((seed, index) => add(seed, index + 4, 3, P3_FUNCTIONS, grammar3));
  return slots;
}

export function buildIeltsShadowingSlots(requestedTopic = ''): IeltsShadowingSlot[] {
  return makeSlots(requestedTopic);
}
export function buildIeltsShadowingPrompt(slots: IeltsShadowingSlot[], repair = false): string {
  const questions = Array.from(new Map(slots.map(slot => [slot.q, `q${slot.q} ${slot.topic}: ${slot.question}`])).values()).join('\n');
  const rows = slots.map(slot => `${slot.q}:${slot.fn} ${slot.grammar}/${FUNCTION_LABEL[slot.fn]}/${slot.bandFeature}/${slot.focus}`).join('\n');
  const spare = repair ? '' : `\nSPARES: two alternative candidates for ${slots[0]?.q}:${slots[0]?.fn} and ${slots[1]?.q}:${slots[1]?.fn}.`;
  return `Write ${repair ? 'only the missing' : '20 assigned plus two spare'} English IELTS Speaking practice sentences, natural Band 7-8 style, for commonly recurring themes (not official questions or answers). One consistent fictional first-person speaker per q group; coherent facts within that answer. Each sentence stands alone, 18-30 words, spoken not essay-like. Apply each row's grammar, function, Band feature and pronunciation focus; vary openings; avoid clichés.
Questions:
${questions}
Rows:
${rows}${spare}
JSON only: {"sentences":[{"q":0,"fn":"A","text":"18-30 words","chunk":"short reusable phrase"}]}. q is an assigned index; fn is A answer, R reason, E example/detail, W concession/reflection. One item per row; no extra keys.`;
}

export function validateIeltsShadowingCandidates(
  candidates: IeltsShadowingCandidate[],
  slots: IeltsShadowingSlot[],
  history: VarietyMemoryEntry[]
): { sentences: ShadowingSentence[]; missing: IeltsShadowingSlot[]; rejected: number; rejectionReasons: Record<string, number> } {
  const buckets = new Map<string, IeltsShadowingCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.q}:${candidate.fn}`;
    const list = buckets.get(key) ?? [];
    list.push(candidate);
    buckets.set(key, list);
  }
  const accepted: ShadowingSentence[] = [];
  const boundedHistory = history.slice(-120);
  const recentHistory = boundedHistory.slice(-40).map(item => item.text);
  const olderHistory = boundedHistory.slice(0, -40).map(item => item.text);
  const acceptedTexts: string[] = [];
  const openings = new Map<string, number>();
  let rejected = 0;
  const rejectionReasons = { wordCount: 0, chunk: 0, cliche: 0, opening: 0, similarity: 0 };
  const missing: IeltsShadowingSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.q}:${slot.fn}`;
    const bucket = buckets.get(key) ?? [];
    let chosen: IeltsShadowingCandidate | undefined;
    while (bucket.length && !chosen) {
      const candidate = bucket.shift()!;
      const text = String(candidate.text ?? '').replace(/\s+/gu, ' ').trim();
      const chunk = String(candidate.chunk ?? '').replace(/\s+/gu, ' ').trim();
      const words = countShadowingLanguageUnits(text, 'en');
      const lower = text.toLocaleLowerCase();
      const cliché = IELTS_BANNED_CLICHES.some(phrase => lower.includes(phrase));
      const opening = openingKey(text, 'en');
      const tooManyOpenings = (openings.get(opening) ?? 0) >= 2;
      const tooSimilar = recentHistory.some(previous => sentenceSimilarity(text, previous, 'en') >= 0.6) ||
        olderHistory.some(previous => sentenceSimilarity(text, previous, 'en') >= 0.7) ||
        acceptedTexts.some(previous => sentenceSimilarity(text, previous, 'en') >= 0.6);
      if (words < 18 || words > 30) { rejectionReasons.wordCount++; rejected++; continue; }
      if (!chunk || chunk.split(/\s+/u).length > 8) { rejectionReasons.chunk++; rejected++; continue; }
      if (cliché) { rejectionReasons.cliche++; rejected++; continue; }
      if (tooManyOpenings) { rejectionReasons.opening++; rejected++; continue; }
      if (tooSimilar) { rejectionReasons.similarity++; rejected++; continue; }
      chosen = { ...candidate, text, chunk };
    }
    if (!chosen) { missing.push(slot); continue; }
    const opening = openingKey(chosen.text, 'en');
    openings.set(opening, (openings.get(opening) ?? 0) + 1);
    acceptedTexts.push(chosen.text);
    const words = countShadowingLanguageUnits(chosen.text, 'en');
    accepted.push({
      id: `ai-ielts-shadowing-${Date.now()}-${slot.q}-${slot.fn}-${accepted.length}`,
      difficulty: 'ielts', topic: slot.topic, text: chosen.text,
      phoneticFocus: slot.focus, expectedTotalDurationMs: Math.max(1800, Math.round(words * 430)),
      part: slot.part, question: slot.question, answerFunction: slot.fn, chunk: chosen.chunk, seedId: slot.seedId
    });
  }
  return { sentences: accepted, missing, rejected, rejectionReasons };
}
export function getIeltsShadowingSetStructure(): { part1: number; part2: number; part3: number; total: number } {
  return { part1: 6, part2: 6, part3: 8, total: 20 };
}
