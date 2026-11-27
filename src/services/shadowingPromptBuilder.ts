import type { ShadowingDifficulty } from '../data/shadowingBank';
import { getShadowingLanguage, type ShadowingLanguageCode } from '../data/shadowingLanguages';
import { SHADOWING_LANGUAGE_PROFILES } from '../data/shadowingLanguageProfiles';
import { getPromptVariantLine, type VarietySlot } from './generationVariety';

function levelRubric(level: ShadowingDifficulty): string {
  switch (level) {
    case 'easy': return 'Easy: familiar daily situations, common words, direct patterns; natural, never childish.';
    case 'medium': return 'Medium: varied everyday contexts, vocabulary, natural clauses and connectors.';
    case 'hard': return 'Hard: nuanced situations, precise vocabulary, complex but idiomatic speech.';
    case 'ielts': return 'IELTS: spoken answers for Parts 1–3; natural reasons, examples, hedging and Band 7+ range.';
  }
}
export function buildShadowingPrompt(params: {
  languageCode: ShadowingLanguageCode; difficulty: ShadowingDifficulty; slots: VarietySlot[];
  avoidOpenings: string[]; avoidWords: string[]; requestedTopic?: string; promptVariantId: string;
  rowNumbers?: number[];
}): string {
  const language = getShadowingLanguage(params.languageCode);
  const profile = SHADOWING_LANGUAGE_PROFILES[params.languageCode];
  const rows = params.slots.map((slot, index) =>
    `${params.rowNumbers?.[index] ?? index + 1}|${slot.situation}|${slot.speechAct}|${slot.grammar}|${slot.length}|${slot.focus}`
  ).join('\n');
  const topicValue = params.requestedTopic?.trim().slice(0, 48);
  const topic = topicValue ? `Topic: ${topicValue}.` : '';
  const avoid = `AVOID openings: ${params.avoidOpenings.slice(-8).join(', ') || 'none'}; recent key words: ${params.avoidWords.slice(-8).join(', ') || 'none'}.`;
  return [
    `Write ${params.slots.length} ${language.promptName} sentences. Register: ${profile.register} Language only: ${language.promptName}. Spelling: ${profile.orthography}`,
    levelRubric(params.difficulty),
    topic,
    getPromptVariantLine(params.promptVariantId),
    'Row: n|situation|speech act|grammar|words|pronunciation focus.',
    'Hard slots: sentence i follows its numbered row.',
    rows,
    'Batch: distinct first two words; ≤3 first-person subjects; spoken, one idea.',
    avoid,
    'Focus cites an in-sentence word/sound.',
    `JSON only: {"sentences":[{"n":1,"topic":"...","text":"...","phoneticFocus":"..."}]}; length ${params.difficulty === 'ielts' ? '18–30' : '8–28'}w.`
  ].filter(Boolean).join('\n');
}
export function estimatePromptTokens(prompt: string): number { return Math.ceil(prompt.length / 4); }
