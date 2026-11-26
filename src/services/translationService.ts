import { getPreset, normalizeBaseUrl } from '../config/providers';
import { loadAllSlotsConfig } from '../storage/localStore';
import { resolveSlotTier } from './tierManager';
import { runWithSlotApiFallback } from './apiFallback';
import { nativeHttpRequest } from './httpClient';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';

export interface ShadowingTranslationResult {
  text: string;
  providerName: string;
  modelName: string;
  account: 'primary' | 'secondary';
}
export function buildShadowingTranslationPrompt(text: string, targetLanguage: string, mode: 'translate' | 'grammar' | 'batch' | 'followup' = 'translate'): string {
  const source = text.trim();
  const language = targetLanguage.trim();
  if (!source) throw new Error('Enter a word or sentence to translate.');
  if (source.length > 4000) throw new Error('Text is too long (maximum 4,000 characters).');
  if (mode === 'followup') return [
    `You are a concise language tutor. Answer ONLY in ${language}. The learner asks about the given sentence and its existing grammar explanation. Stay strictly on grammar and usage, and keep the answer short.`,
    'Use the supplied conversation history only as context; do not repeat the full explanation.',
    '',
    'Context and question:',
    source
  ].join('\\n');
  if (mode === 'grammar') return [
    `Explain the grammar of the following text entirely in ${language}. Do not translate the sentence itself.`,
    `Give a learner-friendly explanation in ${language}: explain sentence structure, tense and aspect, clauses, word order, and important grammatical patterns, including why they are used. Add short examples in ${language} when useful.`,
    'For a single word or fragment, explain its grammatical role and common usage. Use concise headings and bullet points.',
    '',
    'Text:',
    source
  ].join('\n');
  if (!language) throw new Error('Choose a target language.');
  if (mode === 'batch') return [
    `Translate every sentence in the JSON array into ${language}.`,
    'Return ONLY a valid JSON array of strings, in the same order and with exactly the same number of items. Do not add markdown or commentary.',
    'Preserve the meaning and natural tone of each sentence.',
    '',
    'Sentences:',
    source
  ].join('\\n');
  return [
    'Translate the following text into ' + language + '.',
    'Preserve the original meaning, tone, and punctuation. Return only the translated text, without labels, explanations, or quotation marks.',
    'If the input is a single word, give its most common natural translation. If it has several meanings, choose the most likely everyday meaning.',
    '',
    'Text:',
    source
  ].join('\n');
}
export function extractShadowingTranslationText(payload: any, wireFormat: 'gemini' | 'openai'): string {
  if (wireFormat === 'gemini') {
    const parts = payload?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts)
      ? parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim()
      : '';
  }
  const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? payload?.text ?? '';
  return typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim()
      : '';
}
export async function translateShadowingText(
  text: string,
  targetLanguage: string,
  transport?: (opts: any) => Promise<any>,
  mode: 'translate' | 'grammar' | 'batch' | 'followup' = 'translate'
): Promise<ShadowingTranslationResult> {
  const prompt = buildShadowingTranslationPrompt(text, targetLanguage, mode);
  const configs = await loadAllSlotsConfig();
  const config = configs.llm_translation;
  const resolved = await resolveSlotTier(config);
  if (resolved.label !== 'Online AI' || resolved.tier === 3) {
    throw new Error('The Translation API is not ready. Open Settings → LLM Translator, configure an API, then save and pass Test API 1 or Test API 2.');
  }

  const attempt = await runWithSlotApiFallback('llm_translation', config, async (attemptConfig, apiKey) => {
    const preset = getPreset('llm_translation', attemptConfig.providerId);
    const baseUrl = normalizeBaseUrl(attemptConfig.baseUrl);
    const wireFormat = resolveWireFormat({ ...attemptConfig, baseUrl });
    let payload: any;

    if (wireFormat === 'gemini') {
      const model = (attemptConfig.modelOrVoice || preset.defaultModelOrVoice).trim();
      const modelPath = model.startsWith('models/') ? model : 'models/' + model;
      const prepared = buildGeminiEndpointRequest({ baseUrl, defaultPath: '/' + modelPath + ':generateContent', apiKey, slotConfig: attemptConfig });
      const response = await nativeHttpRequest<any>({
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } },
        timeoutMs: 60000,
        maxRetries: 1
      }, transport);
      payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    } else {
      const model = (attemptConfig.modelOrVoice || preset.defaultModelOrVoice).trim();
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
            { role: 'system', content: mode === 'grammar'
              ? `You are an expert language tutor. Explain grammar entirely in ${targetLanguage}. Do not translate the source sentence.`
              : mode === 'batch'
                ? `You are a precise translator. Return only a valid JSON array of translated strings in ${targetLanguage}, preserving item count and order.`
                : mode === 'followup'
                  ? `You are a concise language tutor. Answer only in ${targetLanguage}; stay on grammar and usage and keep the answer short.`
                  : 'You are a precise translator. Return only the translation, without labels or explanations.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2
        },
        timeoutMs: 60000,
        maxRetries: 1
      }, transport);
      payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }

    const translated = extractShadowingTranslationText(payload, wireFormat);
    if (!translated) throw new Error('The translation provider returned an empty response.');
    return { text: translated, providerName: preset.name, modelName: attemptConfig.modelOrVoice };
  });

  return { ...attempt.result, account: attempt.account };
}


/** Translate a complete generated set in one translator-slot request. A malformed
 * successful response gets one explicit retry; transport failures are not replayed here. */
export async function translateShadowingSentenceBatch(
  sentences: string[],
  targetLanguage: string,
  transport?: (opts: any) => Promise<any>
): Promise<string[]> {
  if (sentences.length !== 20 || sentences.some(sentence => !sentence.trim())) {
    throw new Error('A translation batch must contain exactly 20 non-empty sentences.');
  }
  const source = JSON.stringify(sentences);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await translateShadowingText(source, targetLanguage, transport, 'batch');
      const parsed = JSON.parse(result.text.replace(/^\uFEFF/, '').trim());
      const values = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.translations) ? parsed.translations : null);
      if (!values || values.length !== sentences.length || values.some((value: unknown) => typeof value !== 'string' || !value.trim())) {
        throw new Error('The translation provider returned an invalid batch.');
      }
      return values.map((value: string) => value.trim());
    } catch (error) {
      lastError = error;
      // Retry only malformed/empty successful output, never a transport/provider failure.
      if (!(error instanceof SyntaxError) && !(error instanceof Error && error.message.includes('invalid batch'))) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not parse the translated sentence set.');
}


export interface GrammarFollowUpInput {
  sentence: string;
  practiceLanguage: string;
  explanationLanguage: string;
  explanation: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
}

export function buildGrammarFollowUpPrompt(input: GrammarFollowUpInput): string {
  const turns = input.history.slice(-6).map(turn => ({ role: turn.role, content: turn.content.slice(0, 1200) }));
  return JSON.stringify({
    sentence: input.sentence,
    practiceLanguage: input.practiceLanguage,
    explanation: input.explanation.slice(0, 3000),
    recentConversation: turns,
    question: input.question.trim().slice(0, 500)
  });
}

export async function askGrammarFollowUp(
  input: GrammarFollowUpInput,
  transport?: (opts: any) => Promise<any>
): Promise<ShadowingTranslationResult> {
  if (!input.question.trim()) throw new Error('Enter a follow-up question.');
  const prompt = buildGrammarFollowUpPrompt(input);
  return translateShadowingText(prompt, input.explanationLanguage, transport, 'followup');
}
