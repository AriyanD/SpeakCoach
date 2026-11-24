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
  const buildPrompt = (requestedCount: number, retryIndex: number, accumulated: string[]): string => {
    const retryNote = retryIndex > 0
      ? `\nThis is completion attempt ${retryIndex + 1}. Return ONLY ${requestedCount} additional sentences. Do not apologize, explain, or repeat any sentence already supplied.`
      : '';
    const existingNote = accumulated.length
      ? `\nAlready accepted sentences (do not repeat or paraphrase): ${accumulated.map(item => `"${item}"`).join(' | ')}.`
      : '';
    return `Create exactly ${requestedCount} original ${language.promptName} shadowing practice sentences for a learner of ${language.promptName}.
IMPORTANT LANGUAGE RULE: Every sentence, topic, and pronunciation guidance MUST be written naturally and entirely in ${language.promptName} (${language.nativeName}). Never answer in English, translate the request, or mix languages, except proper names. This applies to JSON values too.
Difficulty: ${difficulty}.${topicNote}${memoryNote}${existingNote}${retryNote}
Requirements:
- Return exactly ${requestedCount} distinct sentence objects. Count the objects before responding; never add an introduction, notes, markdown, or extra items.
- Every text value must be ONE complete, speakable sentence in natural, contemporary, idiomatic spoken ${language.promptName}. Write what a real person might actually say aloud, not textbook prose, an essay sentence, a slogan, a list, or an artificial grammar exercise.
- Keep each sentence between 8 and 28 words (or an equivalent natural length for this language). Prefer a comfortable breath group that can be spoken smoothly in one go; do not pad sentences just to reach the minimum.
- Make the batch genuinely varied: use different everyday situations, communicative purposes, sentence openings, grammatical patterns, and rhythms. Across the batch, naturally mix forms such as observations, questions, requests, explanations, reactions, plans, comparisons, and conditional thoughts where appropriate. Do not force every category or make the sentences sound like a checklist.
- Give every item a concise, concrete topic and ONE useful, audible pronunciation focus. The focus should identify a feature actually present in that sentence (for example, sentence stress, weak forms, linking, consonant clusters, rhythm, or intonation); avoid vague labels such as simply “pronunciation” or repeating the same focus for the whole batch.
- Match the requested difficulty precisely:
  * Easy: familiar everyday situations, common vocabulary, mostly direct sentence patterns, and little embedding; still natural, not childish.
  * Medium: everyday and less predictable situations, more varied vocabulary, natural multi-clause sentences, and useful connectors or phrasal verbs; avoid unnecessarily academic wording.
  * Hard: nuanced or less familiar situations, precise vocabulary, varied complex structures, and natural idiomatic phrasing; challenging but still plausible in spontaneous conversation, never needlessly obscure or literary.
- Keep the difficulty consistent across the batch. Do not make Hard merely longer, or Easy unnaturally short.
- Avoid clichés, famous quotations, copied material, repeated ideas, near-paraphrases, awkward collocations, overly formal phrasing, and sentences that require specialist knowledge.
- Do not put multiple unrelated ideas into one sentence. Avoid dialogue labels, speaker names, stage directions, pronunciation markup, or explanations inside the sentence text.
- If a topic is requested, keep every item within it while exploring clearly different real-life angles. If no topic is requested, cover a broad mix of useful, realistic situations rather than clustering around one theme.
- If a response is incomplete or truncated, prioritize valid complete sentence objects; the app will request any missing items separately.
Return ONLY valid JSON in this exact shape:
{"sentences":[{"topic":"localized topic","text":"localized sentence","phoneticFocus":"localized pronunciation guidance"}]}
The sentences array must contain exactly ${requestedCount} items.`;
  };

  const collected: GeneratedShadowingSentence[] = [];
  const seen = new Set<string>();
  let lastError = '';
  // Some compatible models silently truncate or under-deliver large JSON arrays.
  // Retry only the missing remainder instead of discarding a usable partial response.
  for (let batchAttempt = 0; batchAttempt < 4 && collected.length < count; batchAttempt++) {
    const remaining = count - collected.length;
    const prompt = buildPrompt(remaining, batchAttempt, collected.map(sentence => sentence.text));
    try {
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
              generationConfig: { temperature: 0.75, responseMimeType: 'application/json' }
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
                { role: 'system', content: `You generate idiomatic ${language.promptName} practice material. Strictly obey the target language and the requested JSON array length. Return valid JSON only.` },
                { role: 'user', content: prompt }
              ],
              temperature: 0.75,
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
        const items = Array.isArray(parsed.sentences) ? parsed.sentences : remaining === 1 ? [parsed] : [];
        const accepted: GeneratedShadowingSentence[] = [];
        for (const item of items) {
          try {
            const sentence = parseSentence(JSON.stringify(item), difficulty, language.code);
            const normalized = normalizeShadowingSentenceForDuplicateCheck(sentence.text);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            accepted.push({ ...sentence, providerName: attemptPreset.name, modelName: attemptConfig.modelOrVoice });
          } catch {
            // Skip invalid individual items and retry to fill the shortfall.
          }
        }
        return accepted;
      });
      collected.push(...attempt.result);
      if (collected.length >= count) break;
      lastError = `The AI supplied ${collected.length} of ${count} valid unique sentences after ${batchAttempt + 1} attempt(s).`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (collected.length < count) {
    throw new Error(`Could not complete the sentence set: ${lastError} Please try again.`);
  }
  collected.forEach(sentence => rememberShadowingSentence(sentence.text, language.code));
  return collected;
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
