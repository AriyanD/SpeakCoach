import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { getPreset, normalizeBaseUrl } from '../config/providers';
import type { ResolvedSlotTier, SlotConfig, SlotId, TierLabel } from '../config/types';
import { loadApiKey } from '../storage/keyStore';
import { loadAllSlotsConfig, loadSlotConnectionTestResult } from '../storage/localStore';
import { nativeHttpRequest } from './httpClient';
import { executeWithTierFallback } from './tierManager';
import { buildSpokenTokensFromTranscript, type SpokenWordToken } from './wordAlignment';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';
import { getShadowingLanguage } from '../data/shadowingLanguages';
import { isAzurePronunciationLocaleSupported, toWhisperLanguageCode } from './shadowingSpeechLanguage';

/**
 * Build a multipart/form-data body as a binary Uint8Array.
 * Parts are separated by CRLF boundaries. The file part embeds raw
 * binary bytes (decoded from base64) — no Content-Transfer-Encoding header.
 * This matches what curl -F sends and what Groq/OpenAI expect.
 */
export function buildBinaryMultipartBody(params: {
  boundary: string;
  fields: Array<{ name: string; value: string }>;
  fileField: { name: string; filename: string; contentType: string; dataBase64: string };
}): Uint8Array {
  const enc = new TextEncoder();
  const crlf = '\r\n';
  const dash = '--';

  const chunks: Uint8Array[] = [];

  const push = (s: string) => chunks.push(enc.encode(s));

  // Text fields
  for (const field of params.fields) {
    push(`${dash}${params.boundary}${crlf}`);
    push(`Content-Disposition: form-data; name="${field.name}"${crlf}`);
    push(crlf);
    push(field.value);
    push(crlf);
  }

  // Binary file field (no Content-Transfer-Encoding — raw bytes)
  push(`${dash}${params.boundary}${crlf}`);
  push(`Content-Disposition: form-data; name="${params.fileField.name}"; filename="${params.fileField.filename}"${crlf}`);
  push(`Content-Type: ${params.fileField.contentType}${crlf}`);
  push(crlf);

  // Decode base64 to binary
  const cleanB64 = params.fileField.dataBase64.includes(',')
    ? params.fileField.dataBase64.split(',')[1] ?? ''
    : params.fileField.dataBase64;
  const binaryStr = atob(cleanB64);
  const binaryBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    binaryBytes[i] = binaryStr.charCodeAt(i);
  }
  chunks.push(binaryBytes);
  push(crlf);

  // Final boundary
  push(`${dash}${params.boundary}${dash}${crlf}`);

  // Concatenate all chunks
  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Convert a Uint8Array to a latin-1 binary string so CapacitorHttp can
 * forward the raw bytes without base64-encoding them when the Content-Type
 * is multipart/form-data.
 */
export function uint8ArrayToBinaryString(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}


export type CapacitorFormDataEntry =
  | { type: 'string'; key: string; value: string }
  | { type: 'base64File'; key: string; value: string; fileName: string; contentType: string };

/** Build the FormData wire representation expected by Capacitor 6 Android. */
export function buildCapacitorMultipartEntries(params: {
  fields: Array<{ name: string; value: string }>;
  fileField: { name: string; filename: string; contentType: string; dataBase64: string };
}): CapacitorFormDataEntry[] {
  const cleanBase64 = params.fileField.dataBase64.includes(',')
    ? params.fileField.dataBase64.split(',')[1] ?? ''
    : params.fileField.dataBase64;
  const entries: CapacitorFormDataEntry[] = params.fields.map((field) => ({
    type: 'string', key: field.name, value: field.value
  }));
  entries.push({
    type: 'base64File',
    key: params.fileField.name,
    value: cleanBase64.replace(/\s/g, ''),
    fileName: params.fileField.filename,
    contentType: params.fileField.contentType
  });
  return entries;
}

/** Reject empty/corrupt recordings before uploading them to Groq. */
export function validateWavBase64(wavBase64: string): void {
  const clean = wavBase64.includes(',') ? wavBase64.split(',')[1] ?? '' : wavBase64;
  const normalized = clean.replace(/\s/g, '');
  if (!normalized) throw new Error('No recorded audio was produced. Please record your answer again.');

  let bytes: Uint8Array;
  try {
    const binary = atob(normalized);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    throw new Error('The recorded audio is not valid Base64. Please record your answer again.');
  }

  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('The recording is not a valid WAV file. Please record your answer again.');
  }
  if (tag(36) !== 'data' || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40, true) < 2) {
    throw new Error('The WAV recording contains no audio samples. Please record your answer again.');
  }
}

export interface WhisperVerboseWord {
  word?: string;
  start?: number;
  end?: number;
  probability?: number;
}

export interface WhisperVerboseResponse {
  text?: string;
  duration?: number;
  words?: WhisperVerboseWord[];
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    words?: WhisperVerboseWord[];
  }>;
}

export interface WhisperTranscriptionOutcome {
  transcript: string;
  words: SpokenWordToken[];
  activeTier: ResolvedSlotTier;
  rawProviderResponse?: WhisperVerboseResponse;
}

type TransportFn = (opts: HttpOptions) => Promise<HttpResponse>;

export function parseWhisperWordTimestamps(
  payload: unknown,
  fallbackDurationMs = 3000
): { transcript: string; words: SpokenWordToken[] } {
  if (!payload) {
    return { transcript: '', words: [] };
  }

  let data: WhisperVerboseResponse;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload) as WhisperVerboseResponse;
    } catch {
      const clean = payload.trim();
      return {
        transcript: clean,
        words: buildSpokenTokensFromTranscript(clean, fallbackDurationMs, undefined)
      };
    }
  } else {
    data = payload as WhisperVerboseResponse;
  }

  const rawWordsList: WhisperVerboseWord[] = [];
  if (Array.isArray(data.words) && data.words.length > 0) {
    rawWordsList.push(...data.words);
  } else if (Array.isArray(data.segments)) {
    for (const seg of data.segments) {
      if (Array.isArray(seg.words)) {
        rawWordsList.push(...seg.words);
      }
    }
  }

  const parsedWords: SpokenWordToken[] = rawWordsList
    .map((w) => {
      const text = (w.word ?? '').trim();
      const startSec = typeof w.start === 'number' ? w.start : 0;
      const endSec = typeof w.end === 'number' ? w.end : startSec + 0.25;
      const startMs = Math.max(0, Math.round(startSec * 1000));
      const endMs = Math.max(startMs + 60, Math.round(endSec * 1000));
      const confidence =
        typeof w.probability === 'number' && w.probability > 0 && w.probability <= 1
          ? w.probability
          : undefined;
      return {
        word: text,
        startMs,
        endMs,
        ...(confidence !== undefined ? { confidence } : {})
      };
    })
    .filter((w) => w.word.length > 0);

  const topTranscript = (data.text ?? '').trim();
  const joinedFromWords = parsedWords.map((w) => w.word).join(' ').trim();
  const transcript = topTranscript || joinedFromWords;

  if (parsedWords.length > 0) {
    return { transcript, words: parsedWords };
  }

  if (transcript) {
    const durMs =
      typeof data.duration === 'number' && data.duration > 0
        ? Math.round(data.duration * 1000)
        : fallbackDurationMs;
    return {
      transcript,
      words: buildSpokenTokensFromTranscript(transcript, durMs, undefined)
    };
  }

  return { transcript: '', words: [] };
}

export async function requestGeminiAudioTranscription(params: {
  slotConfig: SlotConfig;
  apiKey: string;
  wavBase64: string;
  durationMs?: number;
  language?: string;
  transport?: TransportFn;
}): Promise<{ transcript: string; words: SpokenWordToken[]; raw: WhisperVerboseResponse }> {
  validateWavBase64(params.wavBase64);
  const model = (params.slotConfig.modelOrVoice || 'gemini-3.8-flash').trim().replace(/^models\//, '');
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const modelPath = `/models/${model}:generateContent`;
  const prepared = buildGeminiEndpointRequest({
    baseUrl,
    defaultPath: modelPath,
    apiKey: params.apiKey,
    slotConfig: params.slotConfig
  });
  const cleanBase64 = params.wavBase64.includes(',')
    ? params.wavBase64.split(',')[1] ?? ''
    : params.wavBase64;
  const response = await nativeHttpRequest<{
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          audioTranscription?: {
            text?: string;
            words?: Array<{ word?: string; startOffset?: string; endOffset?: string }>;
          };
        }>;
      };
    }>;
  }>(
    {
      url: prepared.url,
      method: 'POST',
      headers: prepared.headers,
      data: {
        contents: [{
          role: 'user',
          parts: [
            {
              text: `Transcribe the attached speech exactly as spoken. Preserve all words, repetitions, fillers, and self-corrections. Do not answer or summarize. The spoken language is ${params.language || 'English'}.`
            },
            { inlineData: { mimeType: 'audio/wav', data: cleanBase64.replace(/\s/g, '') } }
          ]
        }],
        generationConfig: {
          temperature: 0,
          // audioTranscriptionConfig is the dedicated transcription-model
          // configuration. General Gemini audio models should not receive it.
          ...( /(?:^|-)transcribe(?:-|$)/i.test(model)
            ? (params.slotConfig.slotId === 'pronunciation_scoring'
              ? { audioTranscriptionConfig: { wordTimestamp: true, mode: 'VERBATIM' } }
              : { audioTranscriptionConfig: { mode: 'VERBATIM' } })
            : {})
        }
      },
      timeoutMs: 60000,
      maxRetries: 1
    },
    params.transport
  );

  const parts = response.data?.candidates?.[0]?.content?.parts ?? [];
  const transcript = parts
    .map((part) => (part.audioTranscription?.text ?? part.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!transcript) {
    throw new Error('Gemini returned no transcript. Check that the selected model supports audio input and that the recording contains speech.');
  }

  const durationMs = params.durationMs ?? 3000;
  const wordAnnotations = parts.flatMap((part) => part.audioTranscription?.words ?? []);
  const words: SpokenWordToken[] = wordAnnotations
    .map((item) => {
      const start = Number.parseFloat((item.startOffset ?? '').replace(/s$/, ''));
      const end = Number.parseFloat((item.endOffset ?? '').replace(/s$/, ''));
      const word = (item.word ?? '').trim();
      if (!word) return null;
      const startMs = Number.isFinite(start) ? Math.max(0, Math.round(start * 1000)) : 0;
      const endMs = Number.isFinite(end) ? Math.max(startMs + 60, Math.round(end * 1000)) : startMs + 250;
      return { word, startMs, endMs };
    })
    .filter((item): item is SpokenWordToken => item !== null);
  return {
    transcript,
    words: words.length ? words : buildSpokenTokensFromTranscript(transcript, durationMs, undefined, params.language?.split('-')[0] ?? 'en'),
    raw: { text: transcript }
  };
}

export async function requestWhisperWordTimestamps(params: {
  slotConfig: SlotConfig;
  apiKey: string;
  wavBase64: string;
  durationMs?: number;
  language?: string;
  transport?: TransportFn;
}): Promise<{ transcript: string; words: SpokenWordToken[]; raw: WhisperVerboseResponse }> {
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl);
  const model = (params.slotConfig.modelOrVoice || 'whisper-large-v3-turbo').trim();
  validateWavBase64(params.wavBase64);

  // Capacitor Android 6 requires the documented FormData entry format. A raw
  // binary string is UTF-8 encoded by the native bridge and corrupts WAV bytes.
  const formDataEntries = buildCapacitorMultipartEntries({
    fields: [
      { name: 'model', value: model },
      { name: 'response_format', value: 'verbose_json' },
      { name: 'timestamp_granularities[]', value: 'word' },
      { name: 'language', value: params.language ?? 'en' }
    ],
    fileField: {
      name: 'file',
      filename: 'utterance.wav',
      contentType: 'audio/wav',
      dataBase64: params.wavBase64
    }
  });
  const boundary = `----SpeakCoachWhisperBoundary${Date.now()}`;

  const prepared = buildCustomEndpointRequest({
    baseUrl,
    defaultPath: '/audio/transcriptions',
    apiKey: params.apiKey,
    slotConfig: params.slotConfig,
    defaultHeaders: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    }
  });

  const res = await nativeHttpRequest<WhisperVerboseResponse>(
    {
      url: prepared.url,
      method: 'POST',
      headers: prepared.headers,
      data: formDataEntries,
      dataType: 'formData',
      responseType: 'json',
      timeoutMs: 60000,
      maxRetries: 2,
      retryDelayMs: 1000
    },
    params.transport
  );

  const parsed = parseWhisperWordTimestamps(res.data, params.durationMs ?? 3000);
  return {
    transcript: parsed.transcript,
    words: parsed.words,
    raw: res.data
  };
}

export interface AzurePronunciationAssessmentResponse {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{
    Lexical?: string;
    PronunciationAssessment?: {
      PronScore?: number;
      AccuracyScore?: number;
      FluencyScore?: number;
      CompletenessScore?: number;
      ProsodyScore?: number;
    };
    Words?: Array<{
      Word?: string;
      Offset?: number | string;
      Duration?: number | string;
      PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
    }>;
  }>;
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Azure's pronunciation endpoint accepts raw 16 kHz PCM WAV bytes and a
 * reference-text assessment header. POSTs are never automatically replayed.
 */
export async function requestAzurePronunciationAssessment(params: {
  slotConfig: SlotConfig;
  apiKey: string;
  wavBase64: string;
  durationMs?: number;
  referenceText: string;
  languageLocale?: string;
  allowNoMatch?: boolean;
  transport?: TransportFn;
}): Promise<{ transcript: string; words: SpokenWordToken[]; raw: WhisperVerboseResponse; recognitionStatus: string }> {
  validateWavBase64(params.wavBase64);
  const referenceText = params.referenceText.trim();
  if (!referenceText) throw new Error('Azure pronunciation assessment requires the reference sentence.');
  if ((params.durationMs ?? 0) > 30000) throw new Error('Azure REST pronunciation assessment supports recordings up to 30 seconds. Trying the secondary speech provider.');
  const language = params.languageLocale ?? 'en-US';
  if (!isAzurePronunciationLocaleSupported(language)) {
    throw new Error(`Azure pronunciation assessment does not support ${language}. Trying another speech provider.`);
  }
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl);
  const endpointPath = params.slotConfig.endpointPathOverride?.trim() || '/speech/recognition/conversation/cognitiveservices/v1';
  const endpoint = endpointPath.startsWith('http://') || endpointPath.startsWith('https://')
    ? endpointPath
    : `${baseUrl}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${separator}format=detailed&language=${encodeURIComponent(language)}`;
  const pronunciationHeader = encodeUtf8Base64(JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Word',
    Dimension: 'Comprehensive',
    EnableMiscue: 'True',
    ...(language.toLowerCase() === 'en-us' ? { EnableProsodyAssessment: 'True' } : {})
  }));
  const cleanBase64 = params.wavBase64.includes(',')
    ? params.wavBase64.split(',')[1] ?? ''
    : params.wavBase64;
  const response = await nativeHttpRequest<AzurePronunciationAssessmentResponse>(
    {
      url,
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': params.apiKey,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
        'Pronunciation-Assessment': pronunciationHeader
      },
      data: cleanBase64.replace(/\s/g, ''),
      dataType: 'file',
      responseType: 'json',
      timeoutMs: 60000,
      maxRetries: 0
    },
    params.transport
  );

  const recognitionStatus = String(response.data?.RecognitionStatus ?? '');
  if (!recognitionStatus) throw new Error('Azure pronunciation endpoint returned no RecognitionStatus.');
  if (recognitionStatus !== 'Success') {
    if (params.allowNoMatch && ['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'].includes(recognitionStatus)) {
      return { transcript: '', words: [], raw: { text: '' }, recognitionStatus };
    }
    throw new Error(`Azure pronunciation assessment did not recognize speech (${recognitionStatus}).`);
  }

  const best = response.data.NBest?.[0];
  const transcript = String(best?.Lexical ?? response.data.DisplayText ?? '').trim();
  if (!transcript) throw new Error('Azure pronunciation assessment returned an empty transcript.');
  const azureWords = best?.Words ?? [];
  const words: SpokenWordToken[] = azureWords.map(item => {
    const startTicks = Number(item.Offset ?? 0);
    const durationTicks = Number(item.Duration ?? 0);
    const accuracy = item.PronunciationAssessment?.AccuracyScore;
    const startMs = Number.isFinite(startTicks) ? Math.max(0, Math.round(startTicks / 10000)) : 0;
    const endMs = Number.isFinite(durationTicks) && durationTicks > 0
      ? startMs + Math.max(60, Math.round(durationTicks / 10000))
      : startMs + 250;
    return {
      word: String(item.Word ?? '').trim(),
      startMs,
      endMs,
      ...(typeof accuracy === 'number' && Number.isFinite(accuracy)
        ? { confidence: Math.max(0.01, Math.min(1, accuracy / 100)) }
        : {})
    };
  }).filter(item => item.word.length > 0);
  const normalizedWords: SpokenWordToken[] = words.length
    ? words
    : buildSpokenTokensFromTranscript(transcript, params.durationMs ?? 3000, undefined, params.language?.split('-')[0] ?? 'en');
  const raw: WhisperVerboseResponse = {
    text: transcript,
    words: normalizedWords.map(word => ({
      word: word.word,
      start: word.startMs / 1000,
      end: word.endMs / 1000,
      probability: word.confidence
    }))
  };
  return { transcript, words: normalizedWords, raw, recognitionStatus };
}

export async function transcribeWithTier2WhisperOrFallback(params: {
  slotId?: Extract<SlotId, 'ielts_stt' | 'pronunciation_scoring'>;
  wavBase64: string;
  durationMs: number;
  offlineTranscript: string;
  offlineConfidence?: number;
  referenceText?: string;
  languageCode?: string;
  languageLocale?: string;
  transport?: TransportFn;
}): Promise<WhisperTranscriptionOutcome> {
  const requestedSlotId = params.slotId ?? 'ielts_stt';
  const configs = await loadAllSlotsConfig();
  const compatibleProviderIds = new Set([
    'azure_pronunciation',
    'whisper_stt',
    'whisper_alignment',
    'custom_openai_stt',
    'gemini_stt',
    'gemini_pronunciation',
    'custom_openai_pronunciation'
  ]);
  const candidates: Array<{
    slotId: 'ielts_stt' | 'pronunciation_scoring';
    config: SlotConfig;
    account: 'primary' | 'secondary';
  }> = [];
  // Strict separation: IELTS can only use its own slot; Shadowing can only
  // use pronunciation_scoring. Rotation is limited to primary/secondary APIs
  // configured inside that one slot.
  const primary = configs[requestedSlotId];
  const primaryTest = await loadSlotConnectionTestResult(requestedSlotId);
  const primaryVerified = !!primaryTest?.ok &&
    primaryTest.providerId === primary.providerId &&
    primaryTest.tier === getPreset(requestedSlotId, primary.providerId).tier;
  if (primaryVerified && compatibleProviderIds.has(primary.providerId) && getPreset(requestedSlotId, primary.providerId).tier !== 3) {
    candidates.push({ slotId: requestedSlotId, config: primary, account: 'primary' });
  }
  const secondary = primary.secondary;
  if (secondary?.verified && compatibleProviderIds.has(secondary.providerId) && getPreset(requestedSlotId, secondary.providerId).tier !== 3) {
    candidates.push({ slotId: requestedSlotId, config: { slotId: requestedSlotId, ...secondary }, account: 'secondary' });
  }

  // Rotate only between the primary and secondary APIs of the requested slot.
  const rotationKey = `speakcoach.stt.rotation.${requestedSlotId}.v1`;
  let rotation = 0;
  try {
    rotation = Number(localStorage.getItem(rotationKey) ?? '0') || 0;
  } catch { /* localStorage may be unavailable in native/test contexts */ }
  const orderedCandidates = candidates.length > 1
    ? candidates.map((_, index) => candidates[(rotation + index) % candidates.length])
    : candidates;
  if (candidates.length > 1) {
    try { localStorage.setItem(rotationKey, String((rotation + 1) % candidates.length)); }
    catch { /* rotation remains best-effort when storage is unavailable */ }
  }
  const preferred = orderedCandidates[0];
  let usedSlotId: 'ielts_stt' | 'pronunciation_scoring' = preferred?.slotId ?? requestedSlotId;
  let usedProviderId = preferred?.config.providerId ?? configs[requestedSlotId].providerId;
  let usedAccount: 'primary' | 'secondary' = preferred?.account ?? 'primary';
  let rawResponse: WhisperVerboseResponse | undefined;

  const outcome = await executeWithTierFallback(
    requestedSlotId,
    async () => {
      if (orderedCandidates.length === 0) {
        throw new Error('No verified speech API is configured for this feature.');
      }
      const errors: string[] = [];
      for (const candidate of orderedCandidates) {
        const candidateSlotId = candidate.slotId;
        const candidateCfg = candidate.config;
        try {
          const apiKey = await loadApiKey(candidateSlotId, candidateCfg.providerId, candidate.account);
          if (!apiKey.trim()) throw new Error('API key is missing.');
          const res = candidateCfg.providerId === 'azure_pronunciation'
            ? await requestAzurePronunciationAssessment({
                slotConfig: candidateCfg,
                apiKey,
                wavBase64: params.wavBase64,
                durationMs: params.durationMs,
                referenceText: params.referenceText ?? '',
                languageLocale: params.languageLocale ?? 'en-US',
                transport: params.transport
              })
            : (candidateCfg.providerId === 'gemini_stt' || resolveWireFormat(candidateCfg) === 'gemini')
              ? await requestGeminiAudioTranscription({
                  slotConfig: candidateCfg,
                  apiKey,
                  wavBase64: params.wavBase64,
                  durationMs: params.durationMs,
                  language: getShadowingLanguage(params.languageCode ?? 'en').promptName,
                  transport: params.transport
                })
              : await requestWhisperWordTimestamps({
                  slotConfig: candidateCfg,
                  apiKey,
                  wavBase64: params.wavBase64,
                  durationMs: params.durationMs,
                  language: toWhisperLanguageCode(params.languageLocale ?? `${params.languageCode ?? 'en'}-US`),
                  transport: params.transport
                });
          usedSlotId = candidateSlotId;
          usedProviderId = candidateCfg.providerId;
          usedAccount = candidate.account;
          rawResponse = res.raw;
          return { transcript: res.transcript, words: res.words };
        } catch (error) {
          errors.push(`${candidateSlotId}/${candidate.account} (${candidateCfg.providerId}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(`Both speech APIs failed. ${errors.join(' | ')}`);
    },
    async () => {
      const cleanOffline = (params.offlineTranscript ?? '').trim();
      const validOfflineConf =
        typeof params.offlineConfidence === 'number' &&
        params.offlineConfidence > 0 &&
        params.offlineConfidence <= 1
          ? params.offlineConfidence
          : undefined;
      const words = cleanOffline
        ? buildSpokenTokensFromTranscript(cleanOffline, params.durationMs, validOfflineConf, params.languageCode ?? 'en')
        : [];
      return { transcript: cleanOffline, words };
    }
  );
  const usedPreset = getPreset(usedSlotId, usedProviderId);
  const activeTier = outcome.activeTier.tier !== 3
    ? {
        ...outcome.activeTier,
        slotId: usedSlotId,
        providerId: usedProviderId,
        providerName: usedPreset.name,
        tier: usedPreset.tier,
        label: (usedPreset.tier === 3 ? 'Basic offline' : 'Online AI') as TierLabel,
        detailLabel: `Online AI (API ${usedAccount === 'secondary' ? '2' : '1'} · Tier ${usedPreset.tier} · ${usedPreset.name})`,
        isFallback: usedAccount === 'secondary'
      }
    : outcome.activeTier;

  return {
    transcript: outcome.result.transcript,
    words: outcome.result.words,
    activeTier,
    rawProviderResponse: rawResponse
  };
}
