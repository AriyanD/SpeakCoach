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

export function buildShadowingTranslationPrompt(text: string, targetLanguage: string, mode: 'translate' | 'grammar' = 'translate'): string {
  const source = text.trim();
  const language = targetLanguage.trim();
  if (!source) throw new Error('Enter a word or sentence to translate.');
  if (mode === 'grammar') {
    if (source.length > 4000) throw new Error('Text is too long to explain (maximum 4,000 characters).');
    return [
    'Explain the English grammar of the following text entirely in English. Do not translate the explanation or use Persian or any other language.',
    'Give a learner-friendly explanation suitable for English learners and IELTS candidates: explain sentence structure, tense and aspect, clauses, word order, and important grammatical patterns, including why they are used. Add short examples in English when useful.',
    'For a single word or fragment, explain its grammatical role and common usage. Use concise headings and bullet points.',
    'Regardless of the selected translation language, the entire grammar explanation must be in English.',
    '',
    'Text:',
    source
  ].join('\\n');
  if (!language) throw new Error('Choose a target language.');
  if (source.length > 4000) throw new Error('Text is too long to translate (maximum 4,000 characters).');
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
  mode: 'translate' | 'grammar' = 'translate'
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
            { role: 'system', content: 'You are a precise translator. Return only the translation, without labels or explanations.' },
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
