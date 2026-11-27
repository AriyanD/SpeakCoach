import { getPreset, normalizeBaseUrl } from '../config/providers';
import { loadAllSlotsConfig } from '../storage/localStore';
import { getProviderVerificationInstructions, resolveSlotTier } from './tierManager';
import { getSlotAccountReadiness, runWithSlotApiFallback } from './apiFallback';
import { nativeHttpRequest } from './httpClient';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';
import { cleanJsonPayload } from './ieltsLlmEvaluator';
import type { ShadowingDifficulty, ShadowingSentence } from '../data/shadowingBank';
import { countShadowingLanguageUnits, getShadowingLanguage, type ShadowingLanguageCode } from '../data/shadowingLanguages';
import { SHADOWING_LANGUAGE_PROFILES } from '../data/shadowingLanguageProfiles';
import { buildShadowingPrompt } from './shadowingPromptBuilder';
import { loadShadowingLanguageHistories } from './shadowingLanguageHistory';
import {
  buildVarietySlots, getVarietyMemory, rememberVarietySentences,
  seedVarietyMemory, validateVarietyBatch, openingKey, SHADOWING_LENGTH_BANDS
} from './generationVariety';
import { buildIeltsShadowingSlots, buildIeltsShadowingPrompt, validateIeltsShadowingCandidates, type IeltsShadowingCandidate } from './ieltsShadowingQuality';

export interface GeneratedShadowingSentence extends ShadowingSentence {
  providerName: string;
  modelName: string;
}
const MAX_BATCH = 20;
export function clampShadowingSentenceBatchCount(count: number): number {
  const safeCount = Number.isFinite(count) ? Math.floor(count) : 20;
  return Math.max(2, Math.min(MAX_BATCH, safeCount));
}
export function normalizeShadowingSentenceForDuplicateCheck(sentence: string): string {
  return sentence.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function findSentenceText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || depth > 4) return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text','sentence','practiceSentence','practice_sentence','utterance','content','output','result','data']) {
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
  const phoneticFocus = String(parsed.phoneticFocus ?? parsed.phonetic_focus ?? '').trim();
  const wordCount = countShadowingLanguageUnits(text, language.code);
  const band = SHADOWING_LENGTH_BANDS[difficulty];
  const minimumWords = Math.max(0, band.min - 2);
  const maximumWords = band.max + 2;
  if (wordCount < minimumWords || wordCount > maximumWords) {
    const unitLabel = language.usesWordSegmentation ? 'words' : 'units';
    throw new Error(`length: The AI response contained ${wordCount} ${unitLabel}; this level allows ${minimumWords}–${maximumWords} ${unitLabel} (target ${band.min}–${band.max}).`);
  }
  return {
    id: `ai-shadowing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    difficulty, topic, text, phoneticFocus,
    expectedTotalDurationMs: Math.max(1800, Math.round(wordCount * 430))
  };
}
export function parseShadowingSentenceResponse(raw: string, difficulty: ShadowingDifficulty, languageCode: ShadowingLanguageCode = 'en'): Omit<GeneratedShadowingSentence, 'providerName' | 'modelName'> {
  return parseSentence(raw, difficulty, languageCode);
}
export function mapShadowingResponseRows(items: unknown[], rowNumbers: number[]): Array<number | null> {
  const used = new Set<number>();
  return items.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const supplied = record.n;
    if (Number.isInteger(supplied) && rowNumbers.includes(supplied as number)) {
      const row = supplied as number;
      if (used.has(row)) return null;
      used.add(row);
      return rowNumbers.indexOf(row);
    }
    const fallbackRow = rowNumbers[index];
    if (fallbackRow === undefined || used.has(fallbackRow)) return null;
    used.add(fallbackRow);
    return index;
  });
}
function focusMatchesSentence(focus: string, text: string, language: ShadowingLanguageCode): boolean {
  const normalizedText = normalizeShadowingSentenceForDuplicateCheck(text);
  const quoted = [...focus.matchAll(/[“"「『‘'«]([^”"」』’'»]{1,40})[”"」』’'»]/gu)]
    .map(match => normalizeShadowingSentenceForDuplicateCheck(match[1]));
  if (quoted.length) return quoted.some(term => term.length > 0 && normalizedText.includes(term));
  if (language === 'zh' || language === 'ja') {
    const compactFocus = normalizeShadowingSentenceForDuplicateCheck(focus).replace(/\s+/gu, '');
    const compactText = normalizedText.replace(/\s+/gu, '');
    const chars = Array.from(compactFocus);
    for (let i = 0; i < chars.length - 1; i++) {
      if (compactText.includes(chars.slice(i, i + 2).join(''))) return true;
    }
    return false;
  }
  const terms = normalizeShadowingSentenceForDuplicateCheck(focus).split(/\s+/u).filter(term => term.length >= 3);
  return terms.some(term => normalizedText.split(' ').includes(term));
}

async function seedFromExistingHistory(languageCode: ShadowingLanguageCode, difficulty: ShadowingDifficulty): Promise<void> {
  try {
    const histories = await loadShadowingLanguageHistories();
    const history = histories[languageCode]?.[difficulty];
    if (!history) return;
    const texts = history.sets.slice(-10).flatMap(set => set.sentences.map(sentence => sentence.text));
    await seedVarietyMemory(languageCode, difficulty, texts);
  } catch { /* Variety memory remains best-effort if legacy history cannot be read. */ }
}
function parseResponseItems(raw: string, expectedCount: number): unknown[] {
  const parsed = JSON.parse(cleanJsonPayload(raw)) as Record<string, unknown>;
  if (Array.isArray(parsed.sentences)) return parsed.sentences;
  return expectedCount === 1 ? [parsed] : [];
}
async function requestSentences(params: {
  prompt: string; difficulty: ShadowingDifficulty; languageCode: ShadowingLanguageCode;
  expectedCount: number; account: 'primary' | 'secondary'; transport?: (opts: any) => Promise<any>;
}): Promise<{ items: unknown[]; providerName: string; modelName: string; account: 'primary' | 'secondary' }> {
  const configs = await loadAllSlotsConfig();
  const config = configs.llm_generator;
  const attempt = await runWithSlotApiFallback('llm_generator', config, async (attemptConfig, apiKey) => {
    const preset = getPreset('llm_generator', attemptConfig.providerId);
    const baseUrl = normalizeBaseUrl(attemptConfig.baseUrl);
    const wireFormat = resolveWireFormat({ ...attemptConfig, baseUrl });
    const temperature = Number((0.7 + Math.random() * 0.3).toFixed(2));
    let raw = '';
    if (wireFormat === 'gemini') {
      const model = (attemptConfig.modelOrVoice || preset.defaultModelOrVoice).trim();
      const modelPath = model.startsWith('models/') ? model : `models/${model}`;
      const prepared = buildGeminiEndpointRequest({ baseUrl, defaultPath: `/${modelPath}:generateContent`, apiKey, slotConfig: attemptConfig });
      const response = await nativeHttpRequest<any>({
        url: prepared.url, method: 'POST', headers: prepared.headers,
        data: { contents: [{ role: 'user', parts: [{ text: params.prompt }] }], generationConfig: { temperature, responseMimeType: 'application/json' } },
        timeoutMs: 60000, maxRetries: 0
      }, params.transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const parts = body?.candidates?.[0]?.content?.parts;
      raw = Array.isArray(parts) ? parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n') : '';
    } else {
      const model = (attemptConfig.modelOrVoice || preset.defaultModelOrVoice).trim();
      const prepared = buildCustomEndpointRequest({ baseUrl, defaultPath: '/chat/completions', apiKey, slotConfig: attemptConfig, defaultHeaders: { 'Content-Type': 'application/json' } });
      const response = await nativeHttpRequest<any>({
        url: prepared.url, method: 'POST', headers: prepared.headers,
        data: {
          model, messages: [
            { role: 'system', content: `Generate idiomatic ${getShadowingLanguage(params.languageCode).promptName} practice material. Return valid JSON only.` },
            { role: 'user', content: params.prompt }
          ],
          temperature, response_format: { type: 'json_object' }
        },
        timeoutMs: 60000, maxRetries: 0
      }, params.transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      const content = body?.choices?.[0]?.message?.content ?? body?.output_text ?? body?.text ?? '';
      raw = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part: any) => part?.text ?? '').filter(Boolean).join('\n') : '';
    }
    return { items: parseResponseItems(raw, params.expectedCount), providerName: preset.name, modelName: attemptConfig.modelOrVoice };
  }, { preferredAccount: params.account });
  return { ...attempt.result, account: attempt.account };
}

async function generateIeltsEnglishShadowingSet(
  requestedTopic: string, transport?: (opts: any) => Promise<any>
): Promise<GeneratedShadowingSentence[]> {
  const languageCode: ShadowingLanguageCode = 'en';
  await seedFromExistingHistory(languageCode, 'ielts');
  const history = await getVarietyMemory(languageCode, 'ielts');
  const slots = buildIeltsShadowingSlots(requestedTopic);
  const primaryReady = await getSlotAccountReadiness('llm_generator', 'primary');
  const secondaryReady = await getSlotAccountReadiness('llm_generator', 'secondary');
  const firstAccount = primaryReady.usable ? 'primary' : secondaryReady.usable ? 'secondary' : 'primary';
  let first: Awaited<ReturnType<typeof requestSentences>>;
  let calls = 0;
  let candidates: IeltsShadowingCandidate[] = [];
  let lastError = '';
  try {
    calls++;
    try {
      first = await requestSentences({
        prompt: buildIeltsShadowingPrompt(slots), difficulty: 'ielts', languageCode,
        expectedCount: 22, account: firstAccount, transport
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const fallback = firstAccount === 'primary'
        ? (secondaryReady.usable ? 'secondary' : 'primary')
        : (primaryReady.usable ? 'primary' : 'secondary');
      calls++;
      first = await requestSentences({
        prompt: buildIeltsShadowingPrompt(slots), difficulty: 'ielts', languageCode,
        expectedCount: 22, account: fallback, transport
      });
    }
    candidates = first.items.filter((item): item is IeltsShadowingCandidate =>
      !!item && typeof item === 'object' &&
      Number.isInteger((item as IeltsShadowingCandidate).q) &&
      ['A','R','E','W'].includes(String((item as IeltsShadowingCandidate).fn))
    );
    let validation = validateIeltsShadowingCandidates(candidates, slots, history);
    if (validation.missing.length && calls < 2) {
      const repairAccount = first.account === 'primary' && secondaryReady.usable
        ? 'secondary'
        : first.account === 'secondary' && primaryReady.usable ? 'primary' : first.account;
      calls++;
      const repair = await requestSentences({
        prompt: buildIeltsShadowingPrompt(validation.missing, true),
        difficulty: 'ielts', languageCode, expectedCount: validation.missing.length,
        account: repairAccount, transport
      });
      const repaired = repair.items.filter((item): item is IeltsShadowingCandidate =>
        !!item && typeof item === 'object' &&
        Number.isInteger((item as IeltsShadowingCandidate).q) &&
        ['A','R','E','W'].includes(String((item as IeltsShadowingCandidate).fn))
      );
      candidates = [...candidates, ...repaired];
      validation = validateIeltsShadowingCandidates(candidates, slots, history);
    }
    if (validation.missing.length) {
      throw new Error(`The model supplied ${validation.sentences.length} of 20 valid answer sentences after ${calls} request(s); ${validation.missing.length} slots remain. Rejected: ${JSON.stringify(validation.rejectionReasons)}. Missing: ${validation.missing.map(slot => `${slot.q}:${slot.fn}`).join(', ')}. ${lastError}`);
    }
    await rememberVarietySentences(languageCode, 'ielts', validation.sentences.map(sentence => sentence.text));
    return validation.sentences.map(sentence => ({
      ...sentence, providerName: first.providerName, modelName: first.modelName
    }));
  } catch (error) {
    throw new Error(`IELTS Shadowing generation failed within the two-request limit: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateAiShadowingSentences(
  difficulty: ShadowingDifficulty, count: number, requestedTopic = '',
  transport?: (opts: any) => Promise<any>, languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence[]> {
  const configs = await loadAllSlotsConfig();
  const config = configs.llm_generator;
  const resolved = await resolveSlotTier(config);
  if (resolved.label !== 'Online AI' || resolved.tier === 3) {
    throw new Error(`The AI sentence generator is not ready because its provider has not passed the required connection test. ${getProviderVerificationInstructions('llm_generator')}`);
  }
  const language = getShadowingLanguage(languageCode);
  if (difficulty === 'ielts' && language.code === 'en' && count === 20) {
    return generateIeltsEnglishShadowingSet(requestedTopic, transport);
  }
  const profile = SHADOWING_LANGUAGE_PROFILES[language.code];
  await seedFromExistingHistory(language.code, difficulty);
  const memory = await getVarietyMemory(language.code, difficulty);
  const firstCount = Math.min(22, count + 2);
  const deck = await buildVarietySlots(language.code, difficulty, firstCount, profile.foci);
  const avoidOpenings = memory.slice(-16).map(item => item.openingKey).filter(Boolean);
  const avoidWords = Array.from(new Set(memory.slice(-16).flatMap(item => item.keyWords))).slice(-8);
  const firstPrompt = buildShadowingPrompt({
    languageCode: language.code, difficulty, slots: deck.slots,
    avoidOpenings, avoidWords, requestedTopic, promptVariantId: deck.promptVariantId
  });
  const collected: GeneratedShadowingSentence[] = [];
  const usedSlots = new Set<number>();
  const seen = new Set<string>();
  const acceptedSlotFoci = new Set<string>();
  let lastError = '';
  let calls = 0;

  const rejectionCounts = new Map<string, number>();
  const consume = (items: unknown[], slotIndices: number[], rowNumbers: number[], providerName: string, modelName: string) => {
    const candidates: Array<{ sentence: GeneratedShadowingSentence; slotIndex: number }> = [];
    const mappedRows = mapShadowingResponseRows(items, rowNumbers);
    for (let i = 0; i < items.length; i++) {
      const rowIndex = mappedRows[i];
      if (rowIndex === null) {
        rejectionCounts.set('row', (rejectionCounts.get('row') ?? 0) + 1);
        continue;
      }
      try {
        const rawItem = items[i] as Record<string, unknown> | null;
        if (!rawItem || typeof rawItem.topic !== 'string' || !rawItem.topic.trim()) throw new Error('Missing localized topic.');
        const sentence = parseSentence(JSON.stringify(rawItem), difficulty, language.code);
        if (!focusMatchesSentence(sentence.phoneticFocus, sentence.text, language.code)) {
          rejectionCounts.set('focus', (rejectionCounts.get('focus') ?? 0) + 1);
          continue;
        }
        candidates.push({
          sentence: { ...sentence, providerName, modelName, promptVariantId: deck.promptVariantId },
          slotIndex: slotIndices[rowIndex]
        });
      } catch (error) {
        const reason = error instanceof Error && error.message.startsWith('length:') ? 'length' : 'invalid';
        rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
      }
    }
    const variety = validateVarietyBatch(candidates.map(item => item.sentence.text), language.code, [
      ...memory,
      ...collected.map(item => ({ openingKey: '', keyWords: [], text: item.text }))
    ], 0.5, collected.map(item => openingKey(item.text, language.code)));
    for (const rejected of variety.rejected) {
      rejectionCounts.set(rejected.reason, (rejectionCounts.get(rejected.reason) ?? 0) + 1);
    }
    const acceptedOpenings = new Set(collected.map(item => openingKey(item.text, language.code)));
    const requiredDistinctOpenings = Math.min(18, count);
    const requiredDistinctFoci = Math.min(8, count);
    for (const localIndex of variety.accepted) {
      const candidate = candidates[localIndex];
      if (!candidate || usedSlots.has(candidate.slotIndex)) continue;
      const opening = openingKey(candidate.sentence.text, language.code);
      if (acceptedOpenings.has(opening) && acceptedOpenings.size < requiredDistinctOpenings) {
        rejectionCounts.set('opening', (rejectionCounts.get('opening') ?? 0) + 1);
        continue;
      }
      const assignedFocus = deck.slots[candidate.slotIndex]?.focus ?? '';
      if (assignedFocus && acceptedSlotFoci.has(assignedFocus) && acceptedSlotFoci.size < requiredDistinctFoci) {
        rejectionCounts.set('focus-slot', (rejectionCounts.get('focus-slot') ?? 0) + 1);
        continue;
      }
      const normalized = normalizeShadowingSentenceForDuplicateCheck(candidate.sentence.text);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      acceptedOpenings.add(opening);
      if (assignedFocus) acceptedSlotFoci.add(assignedFocus);
      usedSlots.add(candidate.slotIndex);
      collected.push(candidate.sentence);
      if (collected.length >= count) break;
    }
  };
  try {
    const primaryReady = await getSlotAccountReadiness('llm_generator', 'primary');
    const secondaryReady = await getSlotAccountReadiness('llm_generator', 'secondary');
    const firstAccount = primaryReady.usable ? 'primary' : secondaryReady.usable ? 'secondary' : 'primary';
    calls++;
    let first: Awaited<ReturnType<typeof requestSentences>>;
    try {
      first = await requestSentences({
        prompt: firstPrompt, difficulty, languageCode: language.code,
        expectedCount: firstCount, account: firstAccount, transport
      });
    } catch (firstError) {
      lastError = firstError instanceof Error ? firstError.message : String(firstError);
      const fallbackAccount = firstAccount === 'primary'
        ? (secondaryReady.usable ? 'secondary' : 'primary')
        : (primaryReady.usable ? 'primary' : 'secondary');
      calls++;
      first = await requestSentences({
        prompt: firstPrompt, difficulty, languageCode: language.code,
        expectedCount: firstCount, account: fallbackAccount, transport
      });
    }
    consume(first.items, deck.slots.map((_, index) => index), deck.slots.map((_, index) => index + 1), first.providerName, first.modelName);

    // One repair request is retained for providers that under-deliver a large
    // JSON array. It uses the other verified account where possible. The total
    // generation-request budget is always two, including provider fallback.
    if (collected.length < count && calls < 2) {
      const missing = count - collected.length;
      const unused = deck.slots.map((slot, index) => ({ slot, index }))
        .filter(item => !usedSlots.has(item.index)).slice(0, missing);
      const reasonCodes: Record<string, string> = { invalid: 'bad', length: 'length', row: 'row', focus: 'focus', opening: 'open', similar: 'near', 'focus-slot': 'slot' };
      const reasons = Array.from(rejectionCounts.entries())
        .map(([reason, total]) => `${reasonCodes[reason] ?? reason}${total}`).join(' ') || 'short';
      const repairPrompt = buildShadowingPrompt({
        languageCode: language.code, difficulty, slots: unused.map(item => item.slot),
        rowNumbers: unused.map(item => item.index + 1),
        avoidOpenings: [...avoidOpenings, ...collected.map(item => item.text.split(/\s+/u).slice(0, 2).join(' '))].slice(-16),
        avoidWords: Array.from(new Set([...avoidWords, ...collected.flatMap(item => item.text.split(/\s+/u))])).slice(-8),
        requestedTopic, promptVariantId: deck.promptVariantId
      }) + `\nRepair ${missing}; avoid accepted; rejects ${reasons}.`;
      const repairAccount = first.account === 'primary' && secondaryReady.usable
        ? 'secondary'
        : first.account === 'secondary' && primaryReady.usable
          ? 'primary'
          : first.account;
      calls++;
      const repair = await requestSentences({
        prompt: repairPrompt, difficulty, languageCode: language.code,
        expectedCount: missing, account: repairAccount, transport
      });
      consume(repair.items, unused.map(item => item.index), unused.map(item => item.index + 1), repair.providerName, repair.modelName);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  if (collected.length < count) {
    throw new Error(`Could not complete the sentence set: received ${collected.length} of ${count} valid sentences in at most ${calls} generation request(s). ${lastError} Please try again.`);
  }
  await rememberVarietySentences(language.code, difficulty, collected.map(sentence => sentence.text));
  return collected.slice(0, count);
}

export async function generateAiShadowingSentence(
  difficulty: ShadowingDifficulty, transport?: (opts: any) => Promise<any>,
  requestedTopic = '', languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence> {
  return (await generateAiShadowingSentences(difficulty, 1, requestedTopic, transport, languageCode))[0];
}
export async function generateAiShadowingSentenceBatch(
  difficulty: ShadowingDifficulty, count = 20, requestedTopic = '',
  transport?: (opts: any) => Promise<any>, languageCode: ShadowingLanguageCode = 'en'
): Promise<GeneratedShadowingSentence[]> {
  return generateAiShadowingSentences(difficulty, clampShadowingSentenceBatchCount(count), requestedTopic, transport, languageCode);
}
