import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseLlmSessionPlanResponse,
  requestLlmSessionPlan,
  generateIeltsPlanWithTierFallback,
  createIeltsGenerationContext,
  buildGeneratorPrompt
} from '../src/services/ieltsQuestionGenerator';
import {
  getSeenQuestions,
  clearSeenQuestions,
  markQuestionsSeen,
  getLlmSeenTopics,
  markLlmTopicsSeen,
  getRecentLlmQuestions,
  markLlmQuestionsSeen,
  getCompactLlmGenerationMemory
} from '../src/services/ieltsQuestionTracker';
import { ieltsSessionEngine } from '../src/services/ieltsSessionEngine';
import { loadAllSlotsConfig, saveSlotConfig, saveSlotConnectionTestResult, saveSecondarySlotConfig } from '../src/storage/localStore';
import { loadApiKey, saveApiKey } from '../src/storage/keyStore';
import { clearAllRuntimeFailures, type GlobalTierSummary } from '../src/services/tierManager';
import { createProviderVerificationFingerprint } from '../src/services/providerHealth';
import { networkMonitor } from '../src/services/networkMonitor';
import type { SlotConfig } from '../src/config/types';
import * as ttsService from '../src/services/ttsService';
import { audioRecorder } from '../src/services/audioRecorder';
import { renderIeltsView } from '../src/ui/IeltsView';


async function verifyGeneratorSlot(): Promise<void> {
  const config = (await loadAllSlotsConfig()).llm_generator;
  const apiKey = await loadApiKey('llm_generator', 'gemini_gen');
  const verificationFingerprint = await createProviderVerificationFingerprint(config, apiKey);
  await saveSlotConnectionTestResult('llm_generator', {
    ok: true,
    slotId: 'llm_generator',
    providerId: 'gemini_gen',
    tier: 1,
    label: 'Online AI',
    latencyMs: 1,
    message: 'PASS — test fixture',
    verificationFingerprint: verificationFingerprint ?? undefined
  });
}

describe('IELTS Question Generator (Slot 5 Online AI + Deduplication + Tier Fallback)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    clearSeenQuestions();
    networkMonitor.setOnline(true);
    ieltsSessionEngine.setAllowBuiltinFallback(true);
    ieltsSessionEngine.reset();
  });

  const validPlanJson = {
    part1Topics: ['Architecture', 'Urban Living'],
    part1Questions: [
      { topic: 'Architecture', question: 'What kind of buildings do you like to look at?' },
      { topic: 'Architecture', question: 'Are there any historic buildings in your city?' },
      { topic: 'Architecture', question: 'Do you prefer modern or traditional homes?' },
      { topic: 'Architecture', question: 'How has architecture changed recently in your country?' },
      { topic: 'Urban Living', question: 'Do you prefer living in a city or the countryside?' },
      { topic: 'Urban Living', question: 'What is the biggest advantage of city life?' },
      { topic: 'Urban Living', question: 'How do people commute in your city?' },
      { topic: 'Urban Living', question: 'Would you like to move to a larger metropolis in the future?' }
    ],
    part2CueCard: {
      topic: 'Urban Living',
      title: 'A city you enjoyed visiting',
      prompt: 'Describe a city you have visited that made a strong impression on you.',
      bullets: [
        'Where this city was located',
        'When and why you visited it',
        'What activities you engaged in while there',
        'And explain why it left such a lasting impression on you'
      ]
    },
    part3Questions: [
      { topic: 'Urban Living', question: 'Why do young people gravitate towards major cities?' },
      { topic: 'Urban Living', question: 'How does overcrowding impact urban infrastructure?' },
      { topic: 'Urban Living', question: 'What can governments do to preserve green spaces in modern cities?' },
      { topic: 'Urban Living', question: 'How might remote work change the way cities develop?' }
    ]
  };

  it('keeps generation identifiers internal while applying the assigned topics and angles', () => {
    const first = createIeltsGenerationContext();
    const second = createIeltsGenerationContext();
    expect(first.id).not.toBe(second.id);
    expect(first.preferredAngles).toHaveLength(5);
    expect(second.preferredAngles).toHaveLength(5);

    const firstPrompt = buildGeneratorPrompt([], [], '', first);
    const secondPrompt = buildGeneratorPrompt([], [], '', second);
    expect(firstPrompt.system).not.toContain(first.id);
    expect(firstPrompt.system).not.toContain(first.createdAt);
    expect(firstPrompt.system).toContain(first.part1Topics[0]);
    expect(firstPrompt.system).toContain(first.part3Angles[0]);
    expect(secondPrompt.system).not.toContain(second.id);
    expect(firstPrompt.user).toBe(secondPrompt.user);
    expect(firstPrompt.system).toContain('Avoid close semantic equivalents, not merely identical wording.');
    expect(firstPrompt.system).toContain('rooted in the Part 2 cue card');
    expect(firstPrompt.system).toContain('broader social, cultural, economic, environmental, educational or policy perspectives');
  });

  it('assigns fresh Part 1 topics, cue-card type and distinct Part 3 angles before generation', () => {
    const context = createIeltsGenerationContext(['Accommodation', 'Books and reading', 'Daily routines']);
    expect(context.part1Topics).toHaveLength(2);
    expect(context.part1Topics.some(topic => ['Accommodation', 'Books and reading', 'Daily routines'].includes(topic))).toBe(false);
    expect(context.cueCardType).toBeTruthy();
    expect(context.part3Angles).toHaveLength(2);
    expect(context.part3Angles[0]).not.toBe(context.part3Angles[1]);
    const prompt = buildGeneratorPrompt(['Accommodation'], ['A city you enjoyed visiting'], '', context);
    expect(prompt.system).toContain(`Part 1 topic A: "${context.part1Topics[0]}"`);
    expect(prompt.system).toContain(`Part 2: cue-card type: ${context.cueCardType}`);
    expect(prompt.system).toContain('Recent questions and cue-card titles');
    expect(prompt.system).not.toContain('A memorable journey');
  });

  it('parses valid LLM response JSON into a full IeltsTestSessionPlan and records questions as seen', () => {
    const raw = JSON.stringify(validPlanJson);
    const plan = parseLlmSessionPlanResponse(raw);

    expect(plan.id).toContain('session_llm_');
    expect(plan.part1Questions).toHaveLength(8);
    expect(plan.part1Questions[0].question).toBe('What kind of buildings do you like to look at?');
    expect(plan.part2CueCard.title).toBe('A city you enjoyed visiting');
    expect(plan.part2CueCard.bullets).toHaveLength(4);
    expect(plan.part3Questions).toHaveLength(4);

    // Verify questions were marked in seen tracker
    const seen = getSeenQuestions();
    expect(seen.seenPart1Ids.length).toBe(8);
    expect(seen.seenCueCardIds).toContain(plan.part2CueCard.id);
    expect(seen.seenPart3Ids.length).toBe(4);
  });

  it('rejects question sets that do not meet the IELTS part structure', () => {
    const tooFewPart1 = {
      ...validPlanJson,
      part1Questions: validPlanJson.part1Questions.slice(0, 5)
    };
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(tooFewPart1))).toThrow(/6–8 valid Part 1/i);

    const tooFewPart3 = {
      ...validPlanJson,
      part3Questions: validPlanJson.part3Questions.slice(0, 3)
    };
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(tooFewPart3))).toThrow(/four or five valid discussion questions/i);

    const missingCueCardBullet = {
      ...validPlanJson,
      part2CueCard: { ...validPlanJson.part2CueCard, bullets: validPlanJson.part2CueCard.bullets.slice(0, 3) }
    };
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(missingCueCardBullet))).toThrow(/exactly four non-empty bullet/i);

    const duplicatePart3 = {
      ...validPlanJson,
      part3Questions: [
        ...validPlanJson.part3Questions.slice(0, 3),
        { ...validPlanJson.part3Questions[0] }
      ]
    };
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(duplicatePart3))).toThrow(/duplicate question wording/i);
  });

  it('rejects Part 3 questions that drift away from the Part 2 cue-card theme', () => {
    const unrelatedPlan = {
      ...validPlanJson,
      part3Questions: [
        { topic: 'Cooking', question: 'Why do people enjoy trying unfamiliar recipes?' },
        { topic: 'Cooking', question: 'Should schools teach children how to prepare healthy meals?' },
        { topic: 'Cooking', question: 'How have food delivery services changed family routines?' },
        { topic: 'Cooking', question: 'Will traditional cooking skills become less common in the future?' }
      ]
    };
    expect(() => parseLlmSessionPlanResponse(JSON.stringify(unrelatedPlan))).toThrow(/Part 3 questions must remain connected to the Part 2 cue-card theme/i);
  });

  it('accepts variable but bounded IELTS question counts across sessions', () => {
    const shorterPart1 = [
      ...validPlanJson.part1Questions.slice(0, 3),
      ...validPlanJson.part1Questions.slice(4, 7)
    ];
    const variedPlan = {
      ...validPlanJson,
      part1Questions: shorterPart1,
      part3Questions: validPlanJson.part3Questions
    };
    const plan = parseLlmSessionPlanResponse(JSON.stringify(variedPlan));
    expect(plan.part1Questions).toHaveLength(6);
    expect(plan.part3Questions).toHaveLength(4);
  });

  it('rejects incomplete or malformed LLM responses', () => {
    expect(() => parseLlmSessionPlanResponse('Not JSON')).toThrow();
    expect(() => parseLlmSessionPlanResponse(JSON.stringify({ part1Questions: [] }))).toThrow();
    expect(() =>
      parseLlmSessionPlanResponse(
        JSON.stringify({
          part1Questions: [{ topic: 'T', question: 'Q1' }, { topic: 'T', question: 'Q2' }]
          // Missing part2CueCard and part3Questions
        })
      )
    ).toThrow();
  });

  it('generates questions via Gemini wire format with topic deduplication', async () => {
    // Pre-mark some seen topics
    // The production generator now uses explicit AI-generation memory rather
    // than looking up topics from the retired embedded question bank.
    markLlmTopicsSeen(['Hometown', 'Work & Studies', 'Travel']);

    let sentPayload: any = null;
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      sentPayload = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(validPlanJson) }]
              }
            }
          ]
        }
      };
    };

    const slotConfig: SlotConfig = {
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    };

    const plan = await requestLlmSessionPlan({
      slotConfig,
      apiKey: 'test-gemini-key',
      transport: mockTransport
    });

    expect(plan.part1Questions).toHaveLength(8);
    expect(sentPayload).not.toBeNull();
    const promptText = sentPayload.contents[0].parts[0].text;
    expect(promptText).toContain('Hometown');
    expect(promptText).toContain('Work & Studies');
    expect(promptText).toContain('Recent topics already used');
  });

  it('generates questions via OpenAI wire format with json_object format', async () => {
    let sentPayload: any = null;
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      sentPayload = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify(validPlanJson)
              }
            }
          ]
        }
      };
    };

    const slotConfig: SlotConfig = {
      slotId: 'llm_generator',
      providerId: 'openai_compat_gen',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'gpt-4o-mini',
      authStyle: 'bearer'
    };

    const plan = await requestLlmSessionPlan({
      slotConfig,
      apiKey: 'sk-test-key',
      transport: mockTransport
    });

    expect(plan.part1Questions).toHaveLength(8);
    expect(sentPayload.response_format).toEqual({ type: 'json_object' });
    expect(sentPayload.model).toBe('gpt-4o-mini');
  });

  it('requires an online AI provider when Slot 5 is configured as the retired offline bank', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'offline_bank_gen',
      baseUrl: 'offline://builtin-bank',
      modelOrVoice: 'builtin-v1'
    });

    await expect(generateIeltsPlanWithTierFallback()).rejects.toThrow(/Online AI provider/i);
  });

  it('uses the verified secondary Generator API when the primary Generator API fails', async () => {
    const primaryConfig: SlotConfig = {
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    };
    await saveSlotConfig(primaryConfig);
    await saveApiKey('llm_generator', 'gemini_gen', 'primary-generator-key');
    const primaryGeneratorFingerprint = await createProviderVerificationFingerprint(primaryConfig, 'primary-generator-key');
    await saveSlotConnectionTestResult('llm_generator', {
      ok: true, slotId: 'llm_generator', providerId: 'gemini_gen', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — primary test',
      verificationFingerprint: primaryGeneratorFingerprint ?? undefined
    });
    const secondaryGeneratorConfig = { slotId: 'llm_generator' as const, providerId: 'openai_compat_gen', baseUrl: 'https://api.openai.com/v1', modelOrVoice: 'gpt-4o-mini' };
    const secondaryGeneratorFingerprint = await createProviderVerificationFingerprint(secondaryGeneratorConfig, 'secondary-generator-key');
    await saveSecondarySlotConfig('llm_generator', {
      providerId: 'openai_compat_gen',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'gpt-4o-mini',
      verified: true,
      testResult: { ok: true, latencyMs: 1, message: 'PASS — secondary test', testedAt: Date.now(), verificationFingerprint: secondaryGeneratorFingerprint ?? undefined }
    });
    await saveApiKey('llm_generator', 'openai_compat_gen', 'secondary-generator-key', 'secondary');

    const attemptedUrls: string[] = [];
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      attemptedUrls.push(opts.url);
      if (opts.url.includes('generativelanguage.googleapis.com')) {
        return { url: opts.url, status: 401, headers: {}, data: { error: { message: 'Primary key rejected' } } };
      }
      return {
        url: opts.url,
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { choices: [{ message: { content: JSON.stringify(validPlanJson) } }] }
      };
    };

    const result = await generateIeltsPlanWithTierFallback({ transport });
    expect(attemptedUrls.some(url => url.includes('generativelanguage.googleapis.com'))).toBe(true);
    expect(attemptedUrls.some(url => url.includes('/chat/completions'))).toBe(true);
    expect(result.source).toBe('online_ai');
    expect(result.providerName).toContain('OpenAI-Compatible Generator');
    expect(result.plan.part1Questions).toHaveLength(8);
  });

  it('reports online AI failures instead of substituting prewritten questions', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-key');
    await verifyGeneratorSlot();

    const failingTransport = async (): Promise<HttpResponse> => {
      return {
        status: 503,
        headers: {},
        url: 'https://generativelanguage.googleapis.com',
        data: { error: 'Service Unavailable' }
      };
    };

    await expect(generateIeltsPlanWithTierFallback({ transport: failingTransport })).rejects.toThrow(/503/);
  });

  it('persists LLM-generated topics and excludes them from subsequent AI calls', async () => {
    // 1. Parse a plan containing Architecture and Urban Living
    const raw = JSON.stringify(validPlanJson);
    parseLlmSessionPlanResponse(raw);

    const seenTopics = getLlmSeenTopics();
    expect(seenTopics).toContain('Architecture');
    expect(seenTopics).toContain('Urban Living');

    // 2. Subsequent requestLlmSessionPlan should include these topics in the exclusion list
    let capturedPrompt = '';
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      const data = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      capturedPrompt = data.contents[0].parts[0].text;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: {
          candidates: [{ content: { parts: [{ text: JSON.stringify(validPlanJson) }] } }]
        }
      };
    };

    const slotConfig: SlotConfig = {
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    };

    await requestLlmSessionPlan({
      slotConfig,
      apiKey: 'test-key',
      transport: mockTransport
    });

    expect(capturedPrompt).toContain('Architecture');
    expect(capturedPrompt).toContain('Urban Living');
    expect(capturedPrompt).toContain('Recent topics already used');
  });

  it('persists seen questions and LLM topics across simulated app restart (localStorage survival)', () => {
    // 1. Mark some topics and questions
    markQuestionsSeen({
      part1Ids: ['llm_p1_1_test'],
      cueCardId: 'llm_p2_cc_test',
      part3Ids: ['llm_p3_1_test']
    });
    markLlmTopicsSeen(['Robotics & AI', 'Renewable Energy']);

    // 2. Read directly without clearing localStorage (simulating app restart)
    const seenQs = getSeenQuestions();
    const seenTopics = getLlmSeenTopics();

    expect(seenQs.seenPart1Ids).toContain('llm_p1_1_test');
    expect(seenQs.seenCueCardIds).toContain('llm_p2_cc_test');
    expect(seenTopics).toContain('Robotics & AI');
    expect(seenTopics).toContain('Renewable Energy');
  });


  it('keeps local question memory bounded and sends only a compact recent sample', () => {
    markLlmQuestionsSeen(Array.from({ length: 60 }, (_, index) => `A unique generated question number ${index}?`));
    const localMemory = getRecentLlmQuestions();
    const promptMemory = getCompactLlmGenerationMemory();
    expect(localMemory).toHaveLength(60);
    expect(promptMemory.questions).toHaveLength(60);
    expect(promptMemory.questions[59]).toContain('59');
    expect(promptMemory.questions.every(question => question.length > 0)).toBe(true);
  });

  it('uses a requested theme for Parts 2 and 3 without narrowing the IELTS Part 1 warm-up', async () => {
    const context = createIeltsGenerationContext();
    const prompt = buildGeneratorPrompt([], ['A previous cue card'], 'Sustainable consumption', context);
    expect(prompt.system).toContain('USER-SELECTED THEME FOR PARTS 2 & 3: "Sustainable consumption"');
    expect(prompt.system).toContain('Do not force this theme into Part 1.');
    expect(prompt.system).toContain(`Part 1 topic A: "${context.part1Topics[0]}"`);
    expect(prompt.system).toContain(`Part 1 topic B: "${context.part1Topics[1]}"`);
    expect(prompt.system).not.toContain('Part 1 topic A: "Sustainable consumption"');

    const randomPrompt = buildGeneratorPrompt([], [], '', context);
    expect(randomPrompt.system).toContain(`cue-card type: ${context.cueCardType}`);
    expect(randomPrompt.system).not.toContain('USER-SELECTED THEME FOR PARTS 2 & 3');

    let capturedPrompt = '';
    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      const data = typeof opts.data === 'string' ? JSON.parse(opts.data) : opts.data;
      capturedPrompt = data.contents[0].parts[0].text;
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: { candidates: [{ content: { parts: [{ text: JSON.stringify(validPlanJson) }] } }] }
      };
    };
    markLlmQuestionsSeen(['A previously used question about public transport?']);
    const slotConfig: SlotConfig = {
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    };
    await requestLlmSessionPlan({
      slotConfig,
      apiKey: 'test-key',
      requestedTopic: 'Sustainable consumption',
      transport: mockTransport
    });
    expect(capturedPrompt).toContain('Sustainable consumption');
    expect(capturedPrompt).toContain('Part 1 topic A:');
    expect(capturedPrompt).toContain('Part 1 topic B:');
    expect(capturedPrompt).toContain('Recent questions and cue-card titles');
    expect(capturedPrompt.length).toBeLessThan(9000);
  });

  it('ensures a prefetched plan is consumed only once and cannot be reused', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-key');
    await verifyGeneratorSlot();

    const mockTransport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      url: opts.url,
      data: {
        candidates: [{ content: { parts: [{ text: JSON.stringify(validPlanJson) }] } }]
      }
    });

    // Reset and preload
    ieltsSessionEngine.reset();
    await ieltsSessionEngine.preloadPlan({ transport: mockTransport });

    const snap = ieltsSessionEngine.getState();
    expect(snap.status).toBe('idle');

    // First session consumes the preloaded AI plan
    await ieltsSessionEngine.startSession('part1');
    const firstPlanId = ieltsSessionEngine.getState().sessionId;
    expect(firstPlanId).toContain('session_llm_');

    // End / reset the session
    ieltsSessionEngine.reset();

    // A consumed plan must not be silently reused or replaced by prewritten questions.
    await ieltsSessionEngine.startSession('part1');
    expect(ieltsSessionEngine.getState().status).toBe('error');
    expect(ieltsSessionEngine.getState().sessionId).not.toBe(firstPlanId);

    ieltsSessionEngine.reset();
  });

  it('demonstrably uses mocked Slot 5 Gemini questions in the active session UI, examiner TTS, and history', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-gemini-key');
    await verifyGeneratorSlot();

    const uniqueGeminiQuestions = {
      part1Topics: ['Robotics in Healthcare', 'Urban Megaprojects'],
      part1Questions: [
        { topic: 'Robotics in Healthcare', question: 'How do you envision autonomous robots assisting surgical teams?' },
        { topic: 'Robotics in Healthcare', question: 'Would you trust an AI doctor to diagnose your health symptoms?' },
        { topic: 'Robotics in Healthcare', question: 'What are the main ethical dilemmas of medical algorithms?' },
        { topic: 'Robotics in Healthcare', question: 'How can medical staff adapt to rapid technological disruption?' },
        { topic: 'Urban Megaprojects', question: 'What futuristic infrastructure project has impressed you most?' },
        { topic: 'Urban Megaprojects', question: 'How do smart mega-cities tackle population congestion?' },
        { topic: 'Urban Megaprojects', question: 'Should historic preservation take precedence over modernization?' },
        { topic: 'Urban Megaprojects', question: 'Will subterranean transport corridors solve traffic gridlock?' }
      ],
      part2CueCard: {
        topic: 'Robotics in Healthcare',
        title: 'An innovative medical technology',
        prompt: 'Describe a robotic or AI innovation in healthcare that you found fascinating.',
        bullets: [
          'What this technology is and how it works',
          'Where you first learned or heard about it',
          'What medical condition it aims to alleviate',
          'And explain why you consider this innovation transformative'
        ]
      },
      part3Questions: [
        { topic: 'Robotics in Healthcare', question: 'Will robotic care replace human empathy in nursing homes?' },
        { topic: 'Robotics in Healthcare', question: 'How can developing nations afford expensive automated medical systems?' },
        { topic: 'Robotics in Healthcare', question: 'What legal liabilities arise when surgical robots encounter errors?' },
        { topic: 'Robotics in Healthcare', question: 'How should hospitals balance innovation with patient safety?' }
      ]
    };

    const spokenTexts: string[] = [];
    vi.spyOn(ttsService, 'speakSentenceWithTierFallback').mockImplementation(async (text) => {
      spokenTexts.push(text);
      return {
        activeTier: {
          slotId: 'voice_tts',
          providerId: 'native_tts',
          providerName: 'Native TTS',
          tier: 3,
          label: 'Basic offline',
          detailLabel: 'Native offline',
          isFallback: false
        },
        fromCache: false,
        durationEstimateMs: 300
      };
    });

    const mockGeminiTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      // Validate that Slot 5 actually requested the Gemini endpoint with the configured model & key
      expect(opts.url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
      expect(opts.url).not.toContain('key=');
      expect(opts.headers?.['x-goog-api-key']).toBe('sk-test-gemini-key');
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        url: opts.url,
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(uniqueGeminiQuestions) }]
              }
            }
          ]
        }
      };
    };

    ieltsSessionEngine.reset();
    await ieltsSessionEngine.preloadPlan({ transport: mockGeminiTransport });

    const idleSnap = ieltsSessionEngine.getState();
    expect(idleSnap.questionSource).toBe('AI');
    expect(idleSnap.questionSourceDetails?.providerName).toBe('Google Gemini Generator');
    expect(idleSnap.questionSourceDetails?.modelName).toBe('gemini-3.5-flash-lite');

    // Start session — must consume the Gemini AI questions, NOT built-in bank questions!
    await ieltsSessionEngine.startSession('full');

    const activeSnap = ieltsSessionEngine.getState();
    expect(activeSnap.sessionId).toContain('session_llm_');
    expect(activeSnap.questionSource).toBe('AI');
    expect(activeSnap.questionSourceDetails?.providerName).toBe('Google Gemini Generator');
    expect(activeSnap.questionSourceDetails?.modelName).toBe('gemini-3.5-flash-lite');

    // Verify the step question is demonstrably the first Part 1 question generated by Gemini
    const step1 = activeSnap.currentStep!;
    expect(step1.questionText).toBe('How do you envision autonomous robots assisting surgical teams?');
    expect(step1.canonicalQuestion.text).toBe('How do you envision autonomous robots assisting surgical teams?');
    expect(step1.canonicalQuestion.id).toContain('llm_p1_1_');

    // Examiner TTS should speak this exact Gemini prompt
    await ieltsSessionEngine.startStepExaminerPrompt();
    expect(spokenTexts).toContain('How do you envision autonomous robots assisting surgical teams?');

    // Verify Active View rendering displays the Gemini question in DOM
    const container = document.createElement('div');
    document.body.appendChild(container);
    const mockGlobalSummary: GlobalTierSummary = {
      isOnlineNetwork: true,
      onlineSlotsCount: 2,
      totalSlotsCount: 6,
      label: 'Online AI',
      slots: {
        voice_tts: { slotId: 'voice_tts', providerId: 'native_tts', providerName: 'Native TTS', tier: 3, label: 'Basic offline', detailLabel: 'Native offline', isFallback: false },
        ielts_stt: { slotId: 'ielts_stt', providerId: 'native_stt', providerName: 'Native STT', tier: 3, label: 'Basic offline', detailLabel: 'Native offline', isFallback: false },
        pronunciation_scoring: { slotId: 'pronunciation_scoring', providerId: 'offline_rule_based', providerName: 'Rule-based', tier: 3, label: 'Basic offline', detailLabel: 'Offline', isFallback: false },
        llm_evaluator: { slotId: 'llm_evaluator', providerId: 'gemini_eval', providerName: 'Gemini Evaluator', tier: 1, label: 'Online AI', detailLabel: 'Gemini', isFallback: false },
        llm_generator: { slotId: 'llm_generator', providerId: 'gemini_gen', providerName: 'Google Gemini Generator', tier: 1, label: 'Online AI', detailLabel: 'Gemini', isFallback: false },
        llm_translation: { slotId: 'llm_translation', providerId: 'offline_translation', providerName: 'Translation unavailable offline', tier: 3, label: 'Basic offline', detailLabel: 'No offline translation', isFallback: false }
      }
    };

    localStorage.setItem('speakcoach.app_settings.v1', JSON.stringify({
      allowBuiltinFallback: true,
      showQuestionText: true,
      theme: 'system'
    }));
    const cleanup = renderIeltsView(container, mockGlobalSummary, {
      onComplete: vi.fn(),
      onViewHistory: vi.fn()
    });

    // The display preference is loaded asynchronously from persisted settings.
    await vi.waitFor(() => expect(container.textContent).toContain('How do you envision autonomous robots assisting surgical teams?'));
    // The active session UI must show the Gemini question, NOT the bank questions
    expect(container.textContent).not.toContain('Do you prefer living in a city');

    // Candidate answers
    audioRecorder.setMockRecognizerOutputForTest({
      transcript: 'I believe robotic surgical arms will perform micron-level sutures with zero tremor.',
      confidence: 0.94
    });
    await ieltsSessionEngine.finishCurrentAnswer();

    const answeredSnap = ieltsSessionEngine.getState();
    expect(answeredSnap.completedAnswers).toHaveLength(1);
    expect(answeredSnap.completedAnswers[0].question).toBe('How do you envision autonomous robots assisting surgical teams?');
    expect(answeredSnap.completedAnswers[0].questionId).toContain('llm_p1_1_');

    cleanup();
    ieltsSessionEngine.reset();
  });

  it('seamlessly adopts in-flight Gemini preload when candidate starts session before preload finishes', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-key');
    await verifyGeneratorSlot();

    let resolveHttp: (() => void) | null = null;
    const delayedTransport = async (opts: HttpOptions): Promise<HttpResponse> => {
      return new Promise<HttpResponse>((resolve) => {
        resolveHttp = () => {
          resolve({
            status: 200,
            headers: { 'content-type': 'application/json' },
            url: opts.url,
            data: {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          part1Topics: ['Deep Ocean', 'Ocean Conservation'],
                          part1Questions: [
                            { topic: 'Deep Ocean', question: 'Would you ever explore the Mariana Trench in a submersible?' },
                            { topic: 'Deep Ocean', question: 'What interests you most about the deepest parts of the ocean?' },
                            { topic: 'Deep Ocean', question: 'Have you watched any documentaries about underwater exploration?' },
                            { topic: 'Deep Ocean', question: 'Would you feel comfortable travelling in a deep-sea submarine?' },
                            { topic: 'Ocean Conservation', question: 'How can people reduce plastic pollution in coastal areas?' },
                            { topic: 'Ocean Conservation', question: 'Why are coral reefs important to marine ecosystems?' },
                            { topic: 'Ocean Conservation', question: 'Should governments restrict commercial fishing in some regions?' },
                            { topic: 'Ocean Conservation', question: 'What can schools teach children about protecting marine life?' }
                          ],
                          part2CueCard: {
                            topic: 'Deep Ocean',
                            title: 'An underwater documentary',
                            prompt: 'Describe a documentary on ocean exploration.',
                            bullets: ['Where it took place', 'What was filmed', 'What astonished you', 'And explain its impact']
                          },
                          part3Questions: [
                            { topic: 'Deep Ocean', question: 'How can international treaties protect high-seas seafloor beds?' },
                            { topic: 'Deep Ocean', question: 'Should scientific exploration of the deep ocean be regulated?' },
                            { topic: 'Deep Ocean', question: 'How might climate change affect deep-sea ecosystems?' },
                            { topic: 'Deep Ocean', question: 'Who should be responsible for protecting international waters?' }
                          ]
                        })
                      }
                    ]
                  }
                }
              ]
            }
          });
        };
      });
    };

    ieltsSessionEngine.reset();

    // 1. Preload starts in background
    void ieltsSessionEngine.preloadPlan({ transport: delayedTransport });
    expect(ieltsSessionEngine.getState().isPreloadingPlan).toBe(true);

    // 2. Candidate clicks Start immediately while preload is pending
    ieltsSessionEngine.startSession('part1');

    // 3. Complete the in-flight Gemini network call
    while (!resolveHttp) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const triggerHttp = resolveHttp as (() => void);
    triggerHttp();
    await new Promise((r) => setTimeout(r, 60));

    // 4. Session must have adopted the Gemini AI questions, not built-in questions!
    const activeSnap = ieltsSessionEngine.getState();
    expect(activeSnap.questionSource).toBe('AI');
    expect(activeSnap.sessionId).toContain('session_llm_');
    expect(activeSnap.currentStep?.canonicalQuestion.text).toBe(
      'Would you ever explore the Mariana Trench in a submersible?'
    );

    ieltsSessionEngine.reset();
  });

  it('shows clear error and does not silently fall back to question bank when configured Slot 5 Gemini fails', async () => {
    await saveSlotConfig({
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      modelOrVoice: 'gemini-3.5-flash-lite',
      authStyle: 'query_param'
    });
    await saveApiKey('llm_generator', 'gemini_gen', 'sk-test-key');
    await verifyGeneratorSlot();

    const failingTransport = async (): Promise<HttpResponse> => {
      return {
        status: 503,
        headers: {},
        url: 'https://generativelanguage.googleapis.com',
        data: { error: 'Service Unavailable' }
      };
    };

    ieltsSessionEngine.reset();

    // Preload fails in background
    await ieltsSessionEngine.preloadPlan({ transport: failingTransport });

    // Candidate starts session with Slot 5 configured as Online AI:
    // It MUST NOT silently proceed with built-in questions disguising them as AI!
    await ieltsSessionEngine.startSession('full');

    const snap = ieltsSessionEngine.getState();
    expect(snap.status).toBe('error');
    expect(snap.errorMessage).toContain('AI Question Generation Failed');
    expect(snap.errorMessage).toContain('Google Gemini Generator');
    expect(snap.errorMessage).toContain('503');

    ieltsSessionEngine.reset();
  });
});
