import { getPreset, normalizeBaseUrl } from '../config/providers';
import { loadAllSlotsConfig } from '../storage/localStore';
import { getProviderVerificationInstructions, resolveSlotTier } from './tierManager';
import { runWithSlotApiFallback } from './apiFallback';
import { nativeHttpRequest } from './httpClient';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';
import { cleanJsonPayload } from './ieltsLlmEvaluator';
import type { ShadowingDifficulty, ShadowingSentence } from '../data/shadowingBank';
import { countShadowingLanguageUnits, getShadowingLanguage, type ShadowingLanguageCode } from '../data/shadowingLanguages';

export interface GeneratedShadowingSentence extends ShadowingSentence {
  providerName: string;
  modelName: string;
}

const SHADOWING_MEMORY_KEY = 'speakcoach_shadowing_recent_sentences_v1';
const SHADOWING_MEMORY_KEY_PREFIX = 'speakcoach_shadowing_recent_sentences_v2';
const MAX_SHADOWING_MEMORY = 16;

function getMemoryKey(languageCode: string): string {
  const code = getShadowingLanguage(languageCode).code;
  return code === 'en' ? SHADOWING_MEMORY_KEY : `${SHADOWING_MEMORY_KEY_PREFIX}.${code}`;
}

/** Canonical form used only to detect exact duplicates across generated sentences. */
export function clampShadowingSentenceBatchCount(count: number): number {
  const safeCount = Number.isFinite(count) ? Math.floor(count) : 20;
  return Math.max(2, Math.min(20, safeCount));
}

export function normalizeShadowingSentenceForDuplicateCheck(sentence: string): string {
  return sentence.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function getRecentShadowingMemory(languageCode: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(getMemoryKey(languageCode)) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-MAX_SHADOWING_MEMORY) : [];
  } catch { return []; }
}

function rememberShadowingSentence(sentence: string, languageCode: string): void {
  try {
    const normalized = sentence.replace(/\s+/g, ' ').trim();
    const merged = [...getRecentShadowingMemory(languageCode), normalized];
    const unique = Array.from(new Map(merged.map(item => [item.toLocaleLowerCase(), item])).values());
    localStorage.setItem(getMemoryKey(languageCode), JSON.stringify(unique.slice(-MAX_SHADOWING_MEMORY)));
  } catch { /* local memory is best-effort */ }
}

function findSentenceText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth > 4) return '';
  const record = value as Record<string, unknown>;
  const preferred = ['text', 'sentence', 'practiceSentence', 'practice_sentence', 'utterance', 'content', 'output', 'result', 'data'];
  for (const key of preferred) {
    if (record[key] !== undefined) {
      const found = findSentenceText(record[key], depth + 1);
      if (found.trim()) return found;
    }
  }
  return '';
}

function parseSentence(raw: string, difficulty: ShadowingDifficulty, languageCode: string = 'en'): Omit<GeneratedShadowingSentence, 'providerName' | 'modelName'> {
  if (!raw.trim()) throw new Error('The AI returned an empty response.');
  const parsed = JSON.parse(cleanJsonPayload(raw)) as Record<string, unknown>;
  const text = findSentenceText(parsed).replace(/\s+/g, ' ').trim();
  const language = getShadowingLanguage(languageCode);
  const topic = String(parsed.topic ?? `General ${language.label}`).trim();
  const phoneticFocus = String(parsed.phoneticFocus ?? parsed.phonetic_focus ?? 'Sentence stress and natural linking').trim();
  const wordCount = countShadowingLanguageUnits(text, language.code);
  if (wordCount < 8 || wordCount > 28) {
    throw new Error(`The AI response contained ${wordCount} words; the practice sentence must contain 8–28 words.`);
  }
  return {
    id: `ai-shadowing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    difficulty,
    topic,
    text,
    phoneticFocus,
    expectedTotalDurationMs: Math.max(1800, Math.round(wordCount * 430))
  };
}

export function parseShadowingSentenceResponse(raw: string, difficulty: ShadowingDifficulty, languageCode: ShadowingLanguageCode = 'en'): Omit<GeneratedShadowingSentence, 'providerName' | 'modelName'> {
  return parseSentence(raw, difficulty, languageCode);
}

/** Generate one or several new sentences in a single API call using the verified Slot 5 provider. */
async function generateAiShadowingSentences(
  difficulty: ShadowingDifficulty,
  count: number,
  requestedTopic = '',
  transport?: (opts: any) => Promise<any>,
  languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence[]> {
  const configs = await loadAllSlotsConfig();
  const config = configs.llm_generator;
  const resolved = await resolveSlotTier(config);
  if (resolved.label !== 'Online AI' || resolved.tier === 3) {
    throw new Error(`The AI sentence generator is not ready because its provider has not passed the required connection test. ${getProviderVerificationInstructions('llm_generator')}`);
  }

  const language = getShadowingLanguage(languageCode);
  const recentMemory = getRecentShadowingMemory(language.code).slice(-6).map(text => text.length > 110 ? `${text.slice(0, 107).trimEnd()}…` : text);
  const memoryNote = recentMemory.length ? `\nAvoid copying or closely paraphrasing these recent practice sentences: ${recentMemory.map(text => `"${text}"`).join(' | ')}.` : '';
  const topicNote = requestedTopic.trim() ? `\nRequested topic: ${requestedTopic.trim()}. Keep all sentences within this broad topic, but give each sentence a distinct practical angle and a clear, specific subtopic.` : '';
  const prompt = `Create ${count} original ${language.promptName} shadowing practice sentences for a learner of ${language.promptName}.
Write every sentence, topic, and pronunciation guidance in ${language.promptName}. Do not use English unless it is part of a proper name.
Difficulty: ${difficulty}.${topicNote}${memoryNote}
Requirements:
- Return exactly ${count} different sentences.
- Each sentence must be natural, useful spoken ${language.promptName}; aim for 8 to 28 words (or equivalent language-appropriate units).
- Easy: clear everyday vocabulary and simple structure.
- Medium: varied vocabulary and a moderately complex structure.
- Hard: advanced but natural vocabulary and a complex structure.
- Give every sentence its own short, specific topic and one pronunciation feature relevant to ${language.promptName}.
- Avoid clichés, famous quotations, duplicates, and near-paraphrases.
Return ONLY valid JSON in this exact shape:
{"sentences":[{"topic":"short specific topic in ${language.promptName}","text":"the sentence in ${language.promptName}","phoneticFocus":"one pronunciation feature in ${language.promptName}"},{"topic":"another topic","text":"another sentence","phoneticFocus":"another feature"}]}
The sentences array must contain exactly ${count} items.`;

  const attempt = await runWithSlotApiFallback('llm_generator', config, async (attemptConfig, apiKey) => {
    const attemptPreset = getPreset('llm_generator', attemptConfig.providerId);
    const baseUrl = normalizeBaseUrl(attemptConfig.baseUrl);
    const wireFormat = resolveWireFormat({ ...attemptConfig, baseUrl });
    let raw = '';
    if (wireFormat === 'gemini') {
      const model = (attemptConfig.modelOrVoice || attemptPreset.defaultModelOrVoice).trim();
      const modelPath = model.startsWith('models/') ? model : `models/${model}`;
      const prepared = buildGeminiEndpointRequest({
        baseUrl,
        defaultPath: `/${modelPath}:generateContent`,
        apiKey,
        slotConfig: attemptConfig
      });
      const response = await nativeHttpRequest<any>({
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, responseMimeType: 'application/json' }
        },
        timeoutMs: 60000,
        maxRetries: 1
      }, transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const parts = body?.candidates?.[0]?.content?.parts;
      raw = Array.isArray(parts) ? parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n') : '';
    } else {
      const model = (attemptConfig.modelOrVoice || attemptPreset.defaultModelOrVoice).trim();
      const prepared = buildCustomEndpointRequest({
        baseUrl,
        defaultPath: '/chat/completions',
        apiKey,
        slotConfig: attemptConfig,
        defaultHeaders: { 'Content-Type': 'application/json' }
      });
      const response = await nativeHttpRequest<any>({
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          model,
          messages: [
            { role: 'system', content: `You create concise, high-quality ${language.promptName} shadowing practice material. All user-facing sentence content must be in ${language.promptName}. Return valid JSON only.` },
            { role: 'user', content: prompt }
          ],
          temperature: 0.85,
          response_format: { type: 'json_object' }
        },
        timeoutMs: 60000,
        maxRetries: 1
      }, transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const content = body?.choices?.[0]?.message?.content ?? body?.output_text ?? body?.text ?? '';
      raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: any) => part?.text ?? '').filter(Boolean).join('\n') : '';
    }

    const parsed = JSON.parse(cleanJsonPayload(raw)) as Record<string, unknown>;
    const items = Array.isArray(parsed.sentences) ? parsed.sentences : count === 1 ? [parsed] : [];
    if (items.length !== count) throw new Error(`The AI returned ${items.length} sentences; exactly ${count} were requested. Please try again.`);
    const sentences = items.map(item => {
      const sentence = parseSentence(JSON.stringify(item), difficulty, language.code);
      return { ...sentence, providerName: attemptPreset.name, modelName: attemptConfig.modelOrVoice };
    });
    const uniqueTexts = new Set(sentences.map(sentence => normalizeShadowingSentenceForDuplicateCheck(sentence.text)));
    if (uniqueTexts.size !== sentences.length) throw new Error('The AI returned duplicate sentences. Please generate a new set.');
    return sentences;
  });

  attempt.result.forEach(sentence => rememberShadowingSentence(sentence.text, language.code));
  return attempt.result;
}

export async function generateAiShadowingSentence(
  difficulty: ShadowingDifficulty,
  transport?: (opts: any) => Promise<any>,
  requestedTopic = '',
  languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence> {
  return (await generateAiShadowingSentences(difficulty, 1, requestedTopic, transport, languageCode))[0];
}

/** One efficient API request returns the complete replacement set for a Shadowing practice session. */
export async function generateAiShadowingSentenceBatch(
  difficulty: ShadowingDifficulty,
  count = 20,
  requestedTopic = '',
  transport?: (opts: any) => Promise<any>,
  languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence[]> {
  const target = clampShadowingSentenceBatchCount(count);
  return generateAiShadowingSentences(difficulty, target, requestedTopic, transport, languageCode);
}
