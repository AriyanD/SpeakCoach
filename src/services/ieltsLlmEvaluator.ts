import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { getPreset, normalizeBaseUrl } from '../config/providers';
import type { SlotConfig } from '../config/types';
import { loadAllSlotsConfig } from '../storage/localStore';
import { saveIeltsTestResult, type IeltsTestRecord, type IeltsAttemptComparison } from '../storage/ieltsHistoryStore';
import { nativeHttpRequest, SpeakCoachHttpError } from './httpClient';
import { roundToIeltsBand, type IeltsAnswerInput, type IeltsEvaluationResult, type IeltsGrammarCorrection, type IeltsModelAnswer, type IeltsPerAnswerFeedback, type IeltsVocabularyUpgrade } from './ieltsOfflineEvaluator';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';

export type { IeltsAnswerInput, IeltsEvaluationResult };
import { aggregateIeltsSessionMetrics, computeAnswerSpeechMetrics } from './ieltsSpeechMetrics';
import { logIeltsSessionEvent } from './ieltsTelemetry';
import { resolveSlotTier } from './tierManager';
import { runWithSlotApiFallback } from './apiFallback';

type TransportFn = (opts: HttpOptions) => Promise<HttpResponse>;

let lastLlmEvaluationRaw: unknown = null;
let lastLlmEvaluationError: string | null = null;
let lastLlmEvaluationSnippet: string | null = null;

export class IeltsApiRequiredError extends Error {
  constructor() {
    super('An AI API is required for IELTS evaluation. Configure and test API 1 or API 2, then retry the saved answers.');
    this.name = 'IeltsApiRequiredError';
  }
}

export class LlmEvaluationFailureError extends Error {
  public readonly reason: string;
  public readonly rawError: string;
  public readonly snippet?: string | null;

  constructor(reason: string, rawError: string, snippet?: string | null) {
    super(reason);
    this.name = 'LlmEvaluationFailureError';
    this.reason = reason;
    this.rawError = rawError;
    this.snippet = snippet;
  }
}

export function getLastLlmEvaluationTelemetry(): {
  raw: unknown;
  error: string | null;
  snippet?: string | null;
} {
  return {
    raw: lastLlmEvaluationRaw,
    error: lastLlmEvaluationError,
    snippet: lastLlmEvaluationSnippet
  };
}

export function clearLlmEvaluationTelemetry(): void {
  lastLlmEvaluationRaw = null;
  lastLlmEvaluationError = null;
  lastLlmEvaluationSnippet = null;
}

export function formatLlmFailureReason(
  err: unknown,
  providerName = 'Server',
  snippet?: string
): string {
  const isGoogle = providerName.toLowerCase().includes('gemini') || providerName.toLowerCase().includes('google');
  const isAzure = providerName.toLowerCase().includes('azure');
  const isOpenAi = providerName.toLowerCase().includes('openai') || providerName.toLowerCase().includes('groq');
  const prefix = isGoogle ? 'Google server' : isAzure ? 'Azure server' : isOpenAi ? 'OpenAI server' : 'Provider server';

  if (err instanceof SpeakCoachHttpError) {
    if (err.isTimeout) {
      return `${prefix} request timed out`;
    }
    if (err.status === 429) {
      return `${prefix} rate limit exceeded (HTTP 429)`;
    }
    if (err.status === 503) {
      return `${prefix} overloaded (HTTP 503)`;
    }
    if (err.status === 500) {
      return `${prefix} error (HTTP 500)`;
    }
    return `${prefix} error (HTTP ${err.status})`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Invalid evaluation schema:')) {
    return `${prefix} returned invalid band score (${msg.replace('Invalid evaluation schema: ', '')})${snippet ? ` [snippet: ${snippet.slice(0, 60)}]` : ''}`;
  }
  if (msg.includes('JSON parse failed') || msg.toLowerCase().includes('json')) {
    return `Invalid JSON response from ${prefix}${snippet ? ` [snippet: ${snippet.slice(0, 60)}]` : ''}`;
  }
  if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out') || msg.includes('ETIMEDOUT')) {
    return `${prefix} request timed out`;
  }
  if (msg.includes('503')) {
    return `${prefix} overloaded (HTTP 503)`;
  }
  if (msg.includes('429')) {
    return `${prefix} rate limit exceeded (HTTP 429)`;
  }
  if (msg.includes('500')) {
    return `${prefix} error (HTTP 500)`;
  }
  return `${prefix} error: ${msg}`;
}

export function parseRequiredIeltsBand(value: unknown, fieldName: string): number {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && value.trim().length > 0)
  ) {
    const msg = `Invalid evaluation schema: missing or invalid ${fieldName}`;
    lastLlmEvaluationError = msg;
    throw new Error(msg);
  }
  const num = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(num) || num < 0 || num > 9) {
    const msg = `Invalid evaluation schema: ${fieldName} (${String(value)}) must be a number between 0 and 9`;
    lastLlmEvaluationError = msg;
    throw new Error(msg);
  }
  return roundToIeltsBand(num);
}

export function cleanJsonPayload(text: string): string {
  let cleaned = text.trim();
  // Strip markdown ```json ... ``` code fence if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export function buildIeltsEvaluationPrompt(params: {
  answers: IeltsAnswerInput[];
}): { system: string; user: string } {
  const answerMetrics = params.answers.map((a) =>
    computeAnswerSpeechMetrics({
      transcript: a.transcript,
      durationMs: a.durationMs,
      tokens: a.tokens
    })
  );
  const summary = aggregateIeltsSessionMetrics(answerMetrics);

  const system = `You are an IELTS Speaking assessment assistant using the public IELTS Speaking Band Descriptors (Bands 0–9 in 0.5 increments).
You are not an official or certified IELTS examiner. Provide rigorous, unbiased practice estimates only; do not claim official calibration or certification. DO NOT INFLATE SCORES.
Band Standards Summary:
- Band 9: Native-like precision, effortless fluency, rare slips only.
- Band 8: Fluent with occasional hesitation, wide and flexible vocabulary, majority of sentences error-free.
- Band 7: Speaks at length without noticeable effort, uses less common and idiomatic items, frequently produces error-free sentences.
- Band 6: Willing to speak at length, some loss of coherence, generally adequate vocabulary, uses mix of simple and complex structures.
- Band 5: Slow speech, overuses certain connectives, manages familiar topics, basic sentence forms with frequent errors.
- Band 4: Noticeable pauses, basic vocabulary, simple structures only.

CRITICAL INSTRUCTIONS:
1. Always quote direct evidence from the candidate's actual transcripts.
2. Do not assign a pronunciation score. Speech-recognition confidence is not an IELTS pronunciation measure. Focus only on Fluency & Coherence, Lexical Resource, and Grammatical Range & Accuracy.
3. Return ONLY valid, RFC 8259 JSON without markdown formatting, code fences, or extraneous text.`;

  const transcriptText = params.answers
    .map(
      (a, i) =>
        `[Question ${i + 1} (Part ${a.part})]: "${a.question}"\nCandidate Transcript: "${a.transcript || '(Silence / No speech)'}"\nDuration: ${Math.round(a.durationMs / 1000)}s | Words: ${answerMetrics[i].totalWords} | WPM: ${answerMetrics[i].wordsPerMinute} | Pauses: ${answerMetrics[i].pauseCount} | Fillers: ${answerMetrics[i].fillerCount}`
    )
    .join('\n\n');

  const user = `Candidate IELTS Speaking Session Data:
Overall Session Metrics:
- Total words: ${summary.totalWords}
- Overall WPM: ${summary.overallWpm}
- Total pauses (>=400ms): ${summary.totalPauses} (Long pauses: ${summary.totalLongPauses})
- Total fillers: ${summary.totalFillers} (Top: ${summary.topFillers.map((f) => `"${f.word}": ${f.count}`).join(', ') || 'None'})
- Lexical diversity (TTR): ${summary.averageLexicalDiversity}
- Cohesive linkers used: ${summary.totalLinkers}

Transcripts by Question:
${transcriptText}

Evaluate this performance strictly according to official IELTS band descriptors and output JSON with this exact schema:
{
  "fluencyCoherenceBand": number,
  "lexicalResourceBand": number,
  "grammaticalRangeBand": number,
  "perCriterionComments": {
    "fluency": "...",
    "lexical": "...",
    "grammar": "..."
  },
  "corrections": [
    { "original": "candidate words", "corrected": "improved version", "explanation": "grammar rule" }
  ],
  "vocabularyUpgrades": [
    { "original": "simple word", "upgraded": "band 7+ alternative", "context": "how to apply" }
  ],
  "modelAnswers": [
    { "question": "question text", "band7ModelAnswer": "coherent band 7+ sample answer" }
  ],
  "perAnswerFeedback": [
    { "questionId": "id", "bandEstimate": number, "comment": "short specific feedback" }
  ],
  "topPriorities": [
    "actionable priority 1",
    "actionable priority 2",
    "actionable priority 3"
  ]
}`;

  return { system, user };
}

export async function requestLlmIeltsEvaluation(params: {
  slotConfig: SlotConfig;
  apiKey: string;
  answers: IeltsAnswerInput[];
  transport?: TransportFn;
}): Promise<Partial<IeltsEvaluationResult>> {
  const baseUrl = normalizeBaseUrl(params.slotConfig.baseUrl);
  const prompt = buildIeltsEvaluationPrompt({ answers: params.answers });
  let rawResponseText = '';
  const wireFormat = resolveWireFormat({ ...params.slotConfig, baseUrl });

  if (wireFormat === 'gemini') {
    const model = (params.slotConfig.modelOrVoice || 'gemini-1.5-flash').trim();
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    const prepared = buildGeminiEndpointRequest({
      baseUrl,
      defaultPath: `/${modelPath}:generateContent`,
      apiKey: params.apiKey,
      slotConfig: params.slotConfig
    });
    const res = await nativeHttpRequest<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      {
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          contents: [
            { role: 'user', parts: [{ text: `${prompt.system}\n\n${prompt.user}` }] }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        },
        timeoutMs: 90000,
        maxRetries: 2,
        retryDelayMs: 1000
      },
      params.transport
    );

    rawResponseText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } else {
    // OpenAI / Groq / Custom OpenAI-compatible
    const model = (params.slotConfig.modelOrVoice || 'gpt-4o-mini').trim();
    const prepared = buildCustomEndpointRequest({
      baseUrl,
      defaultPath: '/chat/completions',
      apiKey: params.apiKey,
      slotConfig: params.slotConfig,
      defaultHeaders: {
        'Content-Type': 'application/json'
      }
    });

    const res = await nativeHttpRequest<{
      choices?: Array<{ message?: { content?: string } }>;
    }>(
      {
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: {
          model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        },
        timeoutMs: 90000,
        maxRetries: 2,
        retryDelayMs: 1000
      },
      params.transport
    );

    rawResponseText = res.data?.choices?.[0]?.message?.content ?? '';
  }

  lastLlmEvaluationRaw = rawResponseText;
  const cleaned = cleanJsonPayload(rawResponseText);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    lastLlmEvaluationError = `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(lastLlmEvaluationError);
  }

  const fcBand = parseRequiredIeltsBand(parsed.fluencyCoherenceBand, 'fluencyCoherenceBand');
  const lrBand = parseRequiredIeltsBand(parsed.lexicalResourceBand, 'lexicalResourceBand');
  const graBand = parseRequiredIeltsBand(parsed.grammaticalRangeBand, 'grammaticalRangeBand');

  const commentsObj = (parsed.perCriterionComments as Record<string, string>) || {};
  const perCriterionComments = {
    fluency: commentsObj.fluency || 'Fluency evaluated according to rate of speech and coherence.',
    lexical: commentsObj.lexical || 'Lexical resource evaluated based on range and precision.',
    grammar: commentsObj.grammar || 'Grammar evaluated on sentence structures and accuracy.',
    pronunciation: 'Not assessed — speech-recognition confidence is not an IELTS pronunciation measure.'
  };

  const corrections = Array.isArray(parsed.corrections)
    ? (parsed.corrections as IeltsGrammarCorrection[])
    : [];
  const vocabularyUpgrades = Array.isArray(parsed.vocabularyUpgrades)
    ? (parsed.vocabularyUpgrades as IeltsVocabularyUpgrade[])
    : [];
  const modelAnswers = Array.isArray(parsed.modelAnswers)
    ? (parsed.modelAnswers as IeltsModelAnswer[])
    : [];
  const perAnswerFeedback = Array.isArray(parsed.perAnswerFeedback)
    ? (parsed.perAnswerFeedback as IeltsPerAnswerFeedback[])
    : [];

  const rawPriorities = Array.isArray(parsed.topPriorities)
    ? (parsed.topPriorities as string[])
    : [];
  const topPriorities: [string, string, string] = [
    rawPriorities[0] || 'Expand answers with relevant examples and explanations.',
    rawPriorities[1] || 'Incorporate higher-level discourse markers to enhance cohesion.',
    rawPriorities[2] || 'Vary grammatical structures using complex and conditional clauses.'
  ];

  return {
    fluencyCoherenceBand: fcBand,
    lexicalResourceBand: lrBand,
    grammaticalRangeBand: graBand,
    perCriterionComments,
    corrections,
    vocabularyUpgrades,
    modelAnswers,
    perAnswerFeedback,
    topPriorities
  };
}

export async function evaluateIeltsWithTierFallback(params: {
  answers: IeltsAnswerInput[];
  transport?: TransportFn;
  providerChoice?: 'auto' | 'primary' | 'secondary';
}): Promise<IeltsEvaluationResult> {
  const configs = await loadAllSlotsConfig();
  const slotCfg = configs.llm_evaluator;
  const resolved = await resolveSlotTier(slotCfg);

  const hasVerifiedOnlineSecondary = Boolean(
    slotCfg.secondary?.verified &&
    getPreset('llm_evaluator', slotCfg.secondary.providerId).tier < 3
  );
  if (resolved.tier === 3 && !hasVerifiedOnlineSecondary) {
    throw new IeltsApiRequiredError();
  }

  const answerMetrics = params.answers.map((a) =>
    computeAnswerSpeechMetrics({
      transcript: a.transcript,
      durationMs: a.durationMs,
      tokens: a.tokens
    })
  );
  const sessionMetrics = aggregateIeltsSessionMetrics(answerMetrics);

  // If candidate gave no answers (silent across all questions)
  if (sessionMetrics.totalWords === 0) {
    return {
      overallBand: null,
      fluencyCoherenceBand: null,
      lexicalResourceBand: null,
      grammaticalRangeBand: null,
      pronunciationBand: null,
      pronunciationNotice: 'No speech recognized.',
      perCriterionComments: {
        fluency: 'No answers recorded.',
        lexical: 'No vocabulary used.',
        grammar: 'No sentences spoken.',
        pronunciation: 'No audio signal recognized.'
      },
      corrections: [],
      vocabularyUpgrades: [],
      modelAnswers: [],
      perAnswerFeedback: params.answers.map((a) => ({
        questionId: a.questionId,
        question: a.question,
        transcript: '',
        bandEstimate: null,
        comment: 'No answer recorded.'
      })),
      topPriorities: [
        'Ensure microphone permissions are granted.',
        'Speak clearly and immediately after the tone.',
        'Attempt to answer each question in full.'
      ],
      sessionMetrics,
      answerMetrics,
      activeTier: resolved,
      confidenceLabel: 'no band score without AI evaluation',
      noScoreNotice: 'Candidate gave no answers (no speech detected). No scores produced.'
    };
  }

  // If candidate gave very short answers (fewer than 6 words total)
  if (sessionMetrics.totalWords < 6) {
    return {
      overallBand: null,
      fluencyCoherenceBand: null,
      lexicalResourceBand: null,
      grammaticalRangeBand: null,
      pronunciationBand: null,
      pronunciationNotice: 'Answers were too short for evaluation.',
      perCriterionComments: {
        fluency: `Spoke only ${sessionMetrics.totalWords} words across all questions.`,
        lexical: 'Insufficient speech sample for lexical analysis.',
        grammar: 'Insufficient speech sample for grammar analysis.',
        pronunciation: 'Insufficient speech sample for pronunciation analysis.'
      },
      corrections: [],
      vocabularyUpgrades: [],
      modelAnswers: [],
      perAnswerFeedback: params.answers.map((a, idx) => ({
        questionId: a.questionId,
        question: a.question,
        transcript: a.transcript,
        bandEstimate: null,
        comment: `Spoke ${answerMetrics[idx]?.totalWords ?? 0} words.`
      })),
      topPriorities: [
        'Aim to speak for the full duration of each question.',
        'Elaborate on your answers with explanations and examples.',
        'Speak in full compound and complex sentences.'
      ],
      sessionMetrics,
      answerMetrics,
      activeTier: resolved,
      confidenceLabel: 'no band score without AI evaluation',
      noScoreNotice: `Candidate gave very short answers (${sessionMetrics.totalWords} words total). Insufficient speech to evaluate; no scores produced.`
    };
  }

  try {
    const attempt = await runWithSlotApiFallback('llm_evaluator', slotCfg, (apiConfig, apiKey) =>
      requestLlmIeltsEvaluation({
        slotConfig: apiConfig,
        apiKey,
        answers: params.answers,
        transport: params.transport
      }),
      { preferredAccount: params.providerChoice ?? 'auto' }
    );
    const llmResult = attempt.result;
    const attemptPreset = getPreset('llm_evaluator', attempt.config.providerId);
    const actualActiveTier = {
      ...resolved,
      providerId: attempt.config.providerId,
      providerName: attemptPreset.name,
      tier: attemptPreset.tier,
      label: 'Online AI' as const,
      detailLabel: attempt.account === 'secondary'
        ? `Online AI (API 2 · ${attemptPreset.name})`
        : `Online AI (API 1 · ${attemptPreset.name})`,
      isFallback: attempt.account === 'secondary'
    };

    const fc = parseRequiredIeltsBand(llmResult.fluencyCoherenceBand, 'fluencyCoherenceBand');
    const lr = parseRequiredIeltsBand(llmResult.lexicalResourceBand, 'lexicalResourceBand');
    const gra = parseRequiredIeltsBand(llmResult.grammaticalRangeBand, 'grammaticalRangeBand');
    // ASR confidence measures recognizer certainty, not IELTS pronunciation quality.
    // Pronunciation is therefore left unassessed and excluded from this practice estimate.
    const overallBand = roundToIeltsBand((fc + lr + gra) / 3);

    const comments = llmResult.perCriterionComments ?? {
      fluency: '',
      lexical: '',
      grammar: '',
      pronunciation: ''
    };
    comments.pronunciation = 'Not assessed. Speech-recognition confidence indicates how certain the recognizer is about its transcript; it is not a measure of IELTS pronunciation quality.';

    clearLlmEvaluationTelemetry();

    return {
      overallBand,
      fluencyCoherenceBand: fc,
      lexicalResourceBand: lr,
      grammaticalRangeBand: gra,
      pronunciationBand: null,
      pronunciationNotice: 'Not assessed. The available speech-recognition output cannot validly measure IELTS pronunciation.',
      perCriterionComments: comments,
      corrections: llmResult.corrections ?? [],
      vocabularyUpgrades: llmResult.vocabularyUpgrades ?? [],
      modelAnswers: llmResult.modelAnswers ?? [],
      perAnswerFeedback: llmResult.perAnswerFeedback ?? [],
      topPriorities: llmResult.topPriorities ?? [
        'Expand on key points with concrete personal details.',
        'Use advanced discourse linkers.',
        'Control sentence accuracy.'
      ],
      sessionMetrics,
      answerMetrics,
      activeTier: actualActiveTier,
      confidenceLabel: 'AI practice estimate — not an official IELTS score'
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const rawSnippet =
      typeof lastLlmEvaluationRaw === 'string'
        ? lastLlmEvaluationRaw.slice(0, 300)
        : (lastLlmEvaluationSnippet ?? '');
    const preset = getPreset('llm_evaluator', slotCfg.providerId);
    const formattedReason = formatLlmFailureReason(err, preset.name, rawSnippet);

    lastLlmEvaluationError = rawMsg;
    lastLlmEvaluationSnippet = rawSnippet;

    logIeltsSessionEvent({
      event: 'LLM Evaluation',
      status: 'error',
      error: rawMsg,
      details: rawSnippet ? `Snippet: ${rawSnippet} | Reason: ${formattedReason}` : `Reason: ${formattedReason}`
    });

    throw new LlmEvaluationFailureError(formattedReason, rawMsg, rawSnippet);
  }
}

export async function retryIeltsEvaluation(
  record: IeltsTestRecord,
  transport?: TransportFn,
  options?: { providerChoice?: 'auto' | 'primary' | 'secondary' }
): Promise<IeltsTestRecord> {
  const answersInput: IeltsAnswerInput[] = record.answers.map((a) => ({
    questionId: a.questionId,
    part: a.part === 'part1' ? 1 : a.part === 'part2' ? 2 : 3,
    question: a.questionText,
    transcript: a.transcript,
    durationMs: a.durationSec * 1000,
    wasSkipped: a.wasSkipped
  }));

  try {
    const evalRes = await evaluateIeltsWithTierFallback({
      answers: answersInput,
      transport,
      providerChoice: options?.providerChoice ?? 'auto'
    });
    const historyEntry = {
      id: `evaluation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      evaluatedAt: Date.now(),
      mode: 'api',
      providerChoice: options?.providerChoice ?? 'auto',
      providerId: evalRes.activeTier?.providerId,
      providerName: evalRes.activeTier?.providerName,
      result: evalRes
    } as const;
    const updated: IeltsTestRecord = {
      ...record,
      overallBand: evalRes.overallBand,
      evaluation: evalRes,
      evaluationError: null,
      evaluationHistory: [...(record.evaluationHistory ?? []), historyEntry]
    };
    await saveIeltsTestResult(updated);
    return updated;
  } catch (err) {
    const reason =
      err instanceof LlmEvaluationFailureError
        ? err.reason
        : err instanceof Error
          ? err.message
          : 'Evaluation failed';
    const updated: IeltsTestRecord = {
      ...record,
      evaluationError: reason
    };
    await saveIeltsTestResult(updated);
    throw err;
  }
}


function comparisonBand(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 9) return parsed;
  }
  return null;
}

function parseAttemptComparison(raw: string): IeltsAttemptComparison {
  const parsed = JSON.parse(cleanJsonPayload(raw)) as Record<string, any>;
  const criteria = parsed.criteria ?? {};
  const readCriterion = (key: string) => {
    const item = criteria[key] ?? {};
    const previous = comparisonBand(item.previous);
    const current = comparisonBand(item.current);
    const change = previous !== null && current !== null ? Number((current - previous).toFixed(1)) : null;
    return { previous, current, change, analysis: String(item.analysis ?? 'Not enough evidence for a detailed comparison.') };
  };
  const answerComparisons = Array.isArray(parsed.answerComparisons)
    ? parsed.answerComparisons.slice(0, 15).map((item: any) => ({
        question: String(item.question ?? ''),
        previousAnswer: String(item.previousAnswer ?? ''),
        currentAnswer: String(item.currentAnswer ?? ''),
        analysis: String(item.analysis ?? '')
      }))
    : [];
  return {
    summary: String(parsed.summary ?? 'The comparison could not produce a clear summary.'),
    overallBandPrevious: comparisonBand(parsed.overallBandPrevious),
    overallBandCurrent: comparisonBand(parsed.overallBandCurrent),
    overallBandChange: comparisonBand(parsed.overallBandChange),
    criteria: {
      fluencyCoherence: readCriterion('fluencyCoherence'),
      lexicalResource: readCriterion('lexicalResource'),
      grammar: readCriterion('grammar'),
      pronunciation: { previous: null, current: null, change: null, analysis: 'Not assessed. Speech-recognition confidence is not a measure of IELTS pronunciation quality.' }
    },
    answerComparisons,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 5).map(String) : [],
    priorities: Array.isArray(parsed.priorities) ? parsed.priorities.slice(0, 5).map(String) : []
  };
}

/** Compare two attempts at the same IELTS question set using the configured evaluator API. */
export async function compareIeltsAttempts(
  previous: IeltsTestRecord,
  current: IeltsTestRecord,
  transport?: TransportFn
): Promise<IeltsAttemptComparison> {
  const configs = await loadAllSlotsConfig();
  const slotConfig = configs.llm_evaluator;
  const resolved = await resolveSlotTier(slotConfig);
  if (resolved.tier === 3) throw new Error('Online AI evaluator is not available for attempt comparison.');

  const compactAnswers = (record: IeltsTestRecord) => (record.answers || []).slice(0, 15).map(answer => ({
    question: answer.questionText.slice(0, 240),
    answer: (answer.transcript || '').slice(0, 320),
    part: answer.part,
    skipped: Boolean(answer.wasSkipped)
  }));
  const previousData = {
    date: new Date(previous.timestamp).toISOString(),
    overallBand: previous.overallBand,
    criteria: {
      fluencyCoherence: previous.evaluation?.fluencyCoherenceBand ?? null,
      lexicalResource: previous.evaluation?.lexicalResourceBand ?? null,
      grammar: previous.evaluation?.grammaticalRangeBand ?? null,
      pronunciation: null
    },
    speechMetrics: {
      words: previous.evaluation?.sessionMetrics?.totalWords ?? null,
      wordsPerMinute: previous.evaluation?.sessionMetrics?.overallWpm ?? null,
      pauses: previous.evaluation?.sessionMetrics?.totalPauses ?? null,
      fillers: previous.evaluation?.sessionMetrics?.totalFillers ?? null,
      lexicalDiversity: previous.evaluation?.sessionMetrics?.averageLexicalDiversity ?? null,
      linkers: previous.evaluation?.sessionMetrics?.totalLinkers ?? null
    },
    answers: compactAnswers(previous)
  };
  const currentData = {
    date: new Date(current.timestamp).toISOString(),
    overallBand: current.overallBand,
    criteria: {
      fluencyCoherence: current.evaluation?.fluencyCoherenceBand ?? null,
      lexicalResource: current.evaluation?.lexicalResourceBand ?? null,
      grammar: current.evaluation?.grammaticalRangeBand ?? null,
      pronunciation: null
    },
    speechMetrics: {
      words: current.evaluation?.sessionMetrics?.totalWords ?? null,
      wordsPerMinute: current.evaluation?.sessionMetrics?.overallWpm ?? null,
      pauses: current.evaluation?.sessionMetrics?.totalPauses ?? null,
      fillers: current.evaluation?.sessionMetrics?.totalFillers ?? null,
      lexicalDiversity: current.evaluation?.sessionMetrics?.averageLexicalDiversity ?? null,
      linkers: current.evaluation?.sessionMetrics?.totalLinkers ?? null
    },
    answers: compactAnswers(current)
  };
  const system = 'You are an expert IELTS Speaking examiner comparing two attempts by the same learner on the exact same questions. Be evidence-based and fair. Do not invent changes or infer pronunciation from text. Compare actual answer transcripts, not only scores. Return valid JSON only.';
  const user = `Compare the earlier and newer attempt. Use the scores provided; do not recalculate them. Explain concrete changes in fluency/coherence, lexical resource and grammar. Pronunciation is not assessed by the current implementation; do not infer it from text or speech-recognition confidence. For each matched question, compare the actual answers: development, detail, coherence, vocabulary, grammar, and completeness. Ignore small wording differences unless meaningful. Keep the response concise but specific.

EARLIER ATTEMPT:
${JSON.stringify(previousData)}

NEWER ATTEMPT:
${JSON.stringify(currentData)}

Return this JSON shape:
{
  "summary": "overall progress summary",
  "overallBandPrevious": number or null,\n  "overallBandCurrent": number or null,\n  "overallBandChange": number or null,
  "criteria": {
    "fluencyCoherence": {"previous": number or null, "current": number or null, "analysis": "evidence-based explanation"},
    "lexicalResource": {"previous": number or null, "current": number or null, "analysis": "evidence-based explanation"},
    "grammar": {"previous": number or null, "current": number or null, "analysis": "evidence-based explanation"},
    "pronunciation": {"previous": number or null, "current": number or null, "analysis": "evidence-based explanation"}
  },
  "answerComparisons": [{"question": "question", "previousAnswer": "short excerpt", "currentAnswer": "short excerpt", "analysis": "specific change"}],
  "strengths": ["..."],
  "priorities": ["..."]
}`;

  const attempt = await runWithSlotApiFallback('llm_evaluator', slotConfig, async (apiConfig, apiKey) => {
    const baseUrl = normalizeBaseUrl(apiConfig.baseUrl);
    const wireFormat = resolveWireFormat({ ...apiConfig, baseUrl });
    let raw = '';
    if (wireFormat === 'gemini') {
      const model = (apiConfig.modelOrVoice || 'gemini-1.5-flash').trim();
      const modelPath = model.startsWith('models/') ? model : `models/${model}`;
      const prepared = buildGeminiEndpointRequest({
        baseUrl,
        defaultPath: `/${modelPath}:generateContent`,
        apiKey,
        slotConfig: apiConfig
      });
      const response = await nativeHttpRequest<any>({
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: { contents: [{ role: 'user', parts: [{ text: `${system}\\n\\n${user}` }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } },
        timeoutMs: 90000,
        maxRetries: 1
      }, transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      raw = body?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text ?? '').join('\n') ?? '';
    } else {
      const model = (apiConfig.modelOrVoice || 'gpt-4o-mini').trim();
      const prepared = buildCustomEndpointRequest({ baseUrl, defaultPath: '/chat/completions', apiKey, slotConfig: apiConfig, defaultHeaders: { 'Content-Type': 'application/json' } });
      const response = await nativeHttpRequest<any>({
        url: prepared.url,
        method: 'POST',
        headers: prepared.headers,
        data: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, response_format: { type: 'json_object' } },
        timeoutMs: 90000,
        maxRetries: 1
      }, transport);
      const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      raw = body?.choices?.[0]?.message?.content ?? '';
    }
    return parseAttemptComparison(raw);
  });
  const comparison = attempt.result;
  const score = (record: IeltsTestRecord, key: 'fluencyCoherenceBand' | 'lexicalResourceBand' | 'grammaticalRangeBand' | 'pronunciationBand') =>
    record.evaluation?.[key] ?? null;
  const makeActualCriterion = (
    ai: IeltsAttemptComparison['criteria']['fluencyCoherence'],
    key: 'fluencyCoherenceBand' | 'lexicalResourceBand' | 'grammaticalRangeBand' | 'pronunciationBand'
  ) => {
    const previousScore = score(previous, key);
    const currentScore = score(current, key);
    return {
      ...ai,
      previous: previousScore,
      current: currentScore,
      change: previousScore !== null && currentScore !== null ? Number((currentScore - previousScore).toFixed(1)) : null
    };
  };
  const previousAnswersById = new Map(previous.answers.map(answer => [answer.questionId, answer]));
  const aiAnswerAnalysis = comparison.answerComparisons;
  comparison.answerComparisons = current.answers.slice(0, 15).flatMap(answer => {
    const earlier = previousAnswersById.get(answer.questionId);
    if (!earlier) return [];
    const aiItem = aiAnswerAnalysis.find(item => item.question === answer.questionText);
    return [{
      question: answer.questionText,
      previousAnswer: earlier.transcript || '(No spoken answer)',
      currentAnswer: answer.transcript || '(No spoken answer)',
      analysis: aiItem?.analysis || 'The answers were recorded for comparison, but the AI did not provide a specific comment.'
    }];
  });
  comparison.overallBandPrevious = previous.overallBand;
  comparison.overallBandCurrent = current.overallBand;
  comparison.overallBandChange = previous.overallBand !== null && current.overallBand !== null
    ? Number((current.overallBand - previous.overallBand).toFixed(1))
    : null;
  comparison.criteria = {
    fluencyCoherence: makeActualCriterion(comparison.criteria.fluencyCoherence, 'fluencyCoherenceBand'),
    lexicalResource: makeActualCriterion(comparison.criteria.lexicalResource, 'lexicalResourceBand'),
    grammar: makeActualCriterion(comparison.criteria.grammar, 'grammaticalRangeBand'),
    pronunciation: { previous: null, current: null, change: null, analysis: 'Not assessed. The available speech-recognition data cannot measure IELTS pronunciation quality.' }
  };
  return comparison;
}
