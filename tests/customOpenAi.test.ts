import { describe, expect, it } from 'vitest';
import {
  buildCustomEndpointRequest,
  detectProviderUrlMismatch,
  resolveWireFormat
} from '../src/services/customEndpointHelper';
import { testSlotConnection } from '../src/services/connectionTester';
import { requestLlmIeltsEvaluation } from '../src/services/ieltsLlmEvaluator';
import { fetchAvailableModels } from '../src/services/modelFetchService';
import { bootstrapApp } from '../src/main';
import { saveSlotConfig } from '../src/storage/localStore';
import { loadApiKey, saveApiKey } from '../src/storage/keyStore';

const validGeneratorPlan = {
  part1Questions: [
    { topic: 'Daily routines', question: 'How do you usually plan your day?' },
    { topic: 'Daily routines', question: 'What part of the day do you enjoy most?' },
    { topic: 'Daily routines', question: 'Has your daily routine changed recently?' },
    { topic: 'Public places', question: 'Which public place do you visit most?' },
    { topic: 'Public places', question: 'What makes a public place comfortable?' },
    { topic: 'Public places', question: 'Should cities create more public spaces?' }
  ],
  part2CueCard: {
    topic: 'A useful object',
    title: 'An object you use often',
    prompt: 'Describe an object you use frequently.',
    bullets: ['What it is', 'When you got it', 'How you use it', 'Why it is useful']
  },
  part3Questions: [
    { topic: 'Objects and daily life', question: 'Why do people become attached to certain objects?' },
    { topic: 'Objects and daily life', question: 'How have everyday objects changed in recent decades?' },
    { topic: 'Objects and daily life', question: 'Should products be designed to last longer?' },
    { topic: 'Objects and daily life', question: 'How does advertising influence what people buy?' }
  ]
};

describe('Custom (OpenAI-compatible) Request Builder & Auth Styles (Task F5a)', () => {
  it('builds standard endpoints with default Bearer authorization', () => {
    const req = buildCustomEndpointRequest({
      baseUrl: 'https://api.custom-ai.org/v1/',
      defaultPath: '/chat/completions',
      apiKey: 'secret-key-123',
      slotConfig: {
        slotId: 'llm_evaluator',
        providerId: 'custom_openai_eval',
        baseUrl: 'https://api.custom-ai.org/v1',
        modelOrVoice: 'meta-llama/llama-3-8b-instruct',
        authStyle: 'bearer'
      }
    });

    expect(req.url).toBe('https://api.custom-ai.org/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer secret-key-123');
  });

  it('supports custom header authentication (e.g. X-API-Key or api-key)', () => {
    const req = buildCustomEndpointRequest({
      baseUrl: 'https://gateway.internal.corp:8443',
      defaultPath: '/audio/speech',
      apiKey: 'corp-token-xyz',
      slotConfig: {
        slotId: 'voice_tts',
        providerId: 'custom_openai_tts',
        baseUrl: 'https://gateway.internal.corp:8443',
        modelOrVoice: 'tts-1',
        authStyle: 'custom_header',
        customHeaderName: 'X-API-Key'
      }
    });

    expect(req.url).toBe('https://gateway.internal.corp:8443/audio/speech');
    expect(req.headers['X-API-Key']).toBe('corp-token-xyz');
    expect(req.headers.Authorization).toBeUndefined();
  });

  it('supports query parameter authentication (e.g. ?key= or ?api_key=)', () => {
    const req = buildCustomEndpointRequest({
      baseUrl: 'https://api.myllm.com/v1',
      defaultPath: '/audio/transcriptions',
      apiKey: 'query-key-999',
      slotConfig: {
        slotId: 'ielts_stt',
        providerId: 'custom_openai_stt',
        baseUrl: 'https://api.myllm.com/v1',
        modelOrVoice: 'whisper-custom',
        authStyle: 'query_param',
        customQueryParamName: 'api_key'
      }
    });

    expect(req.url).toBe('https://api.myllm.com/v1/audio/transcriptions?api_key=query-key-999');
    expect(req.headers.Authorization).toBeUndefined();
  });

  it('honors optional endpoint path override for non-standard routes', () => {
    const req = buildCustomEndpointRequest({
      baseUrl: 'https://proxy.example.com',
      defaultPath: '/chat/completions',
      apiKey: 'proxy-key',
      slotConfig: {
        slotId: 'llm_generator',
        providerId: 'custom_openai_gen',
        baseUrl: 'https://proxy.example.com',
        modelOrVoice: 'qwen-2.5-72b',
        authStyle: 'bearer',
        endpointPathOverride: '/custom/v2/generate/chat'
      }
    });

    expect(req.url).toBe('https://proxy.example.com/custom/v2/generate/chat');
    expect(req.headers.Authorization).toBe('Bearer proxy-key');
  });

  it('deep tests Custom OpenAI LLM Generator with custom header and path override', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const res = await testSlotConnection(
      {
        slotId: 'llm_generator',
        providerId: 'custom_openai_gen',
        baseUrl: 'https://my-custom-proxy.org',
        modelOrVoice: 'mistral-large',
        authStyle: 'custom_header',
        customHeaderName: 'X-Custom-Auth',
        endpointPathOverride: '/v1/models/mistral/chat'
      },
      {
        apiKeyOverride: 'custom-secret-777',
        isOnlineOverride: true,
        transport: async (opts) => {
          capturedUrl = opts.url;
          capturedHeaders = (opts.headers as Record<string, string>) || {};
          return {
            status: 200,
            headers: {},
            data: {
              choices: [{ message: { content: JSON.stringify(validGeneratorPlan) } }]
            },
            url: opts.url
          };
        }
      }
    );

    expect(res.ok).toBe(true);
    expect(capturedUrl).toBe('https://my-custom-proxy.org/v1/models/mistral/chat');
    expect(capturedHeaders['X-Custom-Auth']).toBe('custom-secret-777');
    expect(capturedHeaders.Authorization).toBeUndefined();
  });

  it('deep tests Custom OpenAI TTS with free-text voice and query param auth', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;

    const res = await testSlotConnection(
      {
        slotId: 'voice_tts',
        providerId: 'custom_openai_tts',
        baseUrl: 'https://my-custom-tts.org',
        modelOrVoice: 'tts-custom',
        customTtsVoice: 'shimmer',
        authStyle: 'query_param',
        customQueryParamName: 'access_token'
      },
      {
        apiKeyOverride: 'token-abc-123',
        isOnlineOverride: true,
        transport: async (opts) => {
          capturedUrl = opts.url;
          capturedBody = opts.data;
          return {
            status: 200,
            headers: {},
            data: 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA',
            url: opts.url
          };
        }
      }
    );

    expect(res.ok).toBe(true);
    expect(capturedUrl).toBe('https://my-custom-tts.org/audio/speech?access_token=token-abc-123');
    expect((capturedBody as Record<string, unknown>).model).toBe('tts-custom');
    expect((capturedBody as Record<string, unknown>).voice).toBe('shimmer');
  });

  it('deep tests Custom OpenAI STT with custom header auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    const res = await testSlotConnection(
      {
        slotId: 'ielts_stt',
        providerId: 'custom_openai_stt',
        baseUrl: 'https://my-custom-stt.org/v1',
        modelOrVoice: 'whisper-large-v3-custom',
        authStyle: 'custom_header',
        customHeaderName: 'X-Whisper-Key'
      },
      {
        apiKeyOverride: 'stt-key-101',
        isOnlineOverride: true,
        transport: async (opts) => {
          capturedUrl = opts.url;
          capturedHeaders = (opts.headers as Record<string, string>) || {};
          return {
            status: 200,
            headers: {},
            data: {
              text: 'Custom transcription verified',
              words: [{ word: 'Custom', start: 0.1, end: 0.5 }]
            },
            url: opts.url
          };
        }
      }
    );

    expect(res.ok).toBe(true);
    expect(capturedUrl).toBe('https://my-custom-stt.org/v1/audio/transcriptions');
    expect(capturedHeaders['X-Whisper-Key']).toBe('stt-key-101');
    expect(capturedHeaders.Authorization).toBeUndefined();
  });

  it('resolves wire format from Base URL/path (A1-1: Gemini provider with OpenAI gateway uses OpenAI chat format)', async () => {
    const apinexCfg = {
      slotId: 'llm_evaluator' as const,
      providerId: 'gemini_eval',
      baseUrl: 'https://api.apinex.bond/v1',
      modelOrVoice: 'free/gpt-6-luna'
    };

    expect(resolveWireFormat(apinexCfg)).toBe('openai');
    expect(
      resolveWireFormat({
        slotId: 'llm_evaluator',
        providerId: 'gemini_eval',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-1.5-flash'
      })
    ).toBe('gemini');
    expect(
      resolveWireFormat({
        slotId: 'llm_evaluator',
        providerId: 'custom_openai_eval',
        baseUrl: 'https://my-proxy.example.com/v1beta',
        endpointPathOverride: '/models/gemini-1.5-flash:generateContent',
        modelOrVoice: 'gemini-1.5-flash'
      })
    ).toBe('gemini');

    // Deep test uses OpenAI /chat/completions + Bearer header even if providerId is gemini_eval
    let capturedUrl = '';
    let capturedAuth = '';
    const testRes = await testSlotConnection(apinexCfg, {
      apiKeyOverride: 'apinex-key-123',
      isOnlineOverride: true,
      transport: async (opts) => {
        capturedUrl = opts.url;
        capturedAuth = (opts.headers as Record<string, string>)?.Authorization || '';
        return {
          status: 200,
          headers: {},
          url: opts.url,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    fluencyCoherenceBand: 6.5,
                    lexicalResourceBand: 6.5,
                    grammaticalRangeBand: 6.5,
                    perCriterionComments: { fluency: 'ok', lexical: 'ok', grammar: 'ok' },
                    corrections: [],
                    vocabularyUpgrades: [],
                    modelAnswers: [],
                    perAnswerFeedback: [],
                    topPriorities: ['Practice daily']
                  })
                }
              }
            ]
          }
        };
      }
    });
    expect(testRes.ok).toBe(true);
    expect(capturedUrl).toBe('https://api.apinex.bond/v1/chat/completions');
    expect(capturedAuth).toBe('Bearer apinex-key-123');

    // Evaluator also uses OpenAI chat format
    let evalUrl = '';
    const evalOut = await requestLlmIeltsEvaluation({
      slotConfig: apinexCfg,
      apiKey: 'apinex-key-123',
      answers: [
        {
          questionId: 'p1_1',
          part: 1,
          question: 'Do you work or study?',
          transcript: 'I work as a software engineer in a technology company.',
          durationMs: 5000
        }
      ],
      transport: async (opts) => {
        evalUrl = opts.url;
        return {
          status: 200,
          headers: {},
          url: opts.url,
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    fluencyCoherenceBand: 7.0,
                    lexicalResourceBand: 7.0,
                    grammaticalRangeBand: 6.5,
                    perCriterionComments: { fluency: 'Good', lexical: 'Good', grammar: 'Solid' }
                  })
                }
              }
            ]
          }
        };
      }
    });
    expect(evalUrl).toBe('https://api.apinex.bond/v1/chat/completions');
    expect(evalOut.fluencyCoherenceBand).toBe(7.0);

    // Fetch models also uses OpenAI /models with Bearer
    let modelsUrl = '';
    let modelsAuth = '';
    const modelsRes = await fetchAvailableModels(apinexCfg, 'apinex-key-123', {
      transport: async (opts) => {
        modelsUrl = opts.url;
        modelsAuth = (opts.headers as Record<string, string>)?.Authorization || '';
        return {
          status: 200,
          headers: {},
          url: opts.url,
          data: { data: [{ id: 'free/gpt-6-luna' }] }
        };
      }
    });
    expect(modelsUrl).toBe('https://api.apinex.bond/v1/models');
    expect(modelsAuth).toBe('Bearer apinex-key-123');
    expect(modelsRes.models).toEqual(['free/gpt-6-luna']);
  });

  it('includes redacted URL path and response snippet on HTTP 401/403 Deep test failure', async () => {
    const res = await testSlotConnection(
      {
        slotId: 'llm_evaluator',
        providerId: 'gemini_eval',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-1.5-flash'
      },
      {
        apiKeyOverride: 'super-secret-gemini-key',
        isOnlineOverride: true,
        transport: async (opts) => ({
          status: 403,
          headers: {},
          url: opts.url,
          data: { error: { message: 'API key not valid or missing bearer token' } }
        })
      }
    );

    expect(res.ok).toBe(false);
    expect(res.message).toContain('HTTP 403');
    expect(res.message).toContain('Path: /v1beta/models/gemini-1.5-flash:generateContent');
    expect(res.message).not.toContain('super-secret-gemini-key');
    expect(res.message).toContain('Response: API key not valid or missing bearer token');
  });

  it('shows Settings mismatch warning when provider and Base URL disagree, with one-click switch to Custom', async () => {
    await saveSlotConfig({
      slotId: 'llm_evaluator',
      providerId: 'gemini_eval',
      baseUrl: 'https://api.apinex.bond/v1',
      modelOrVoice: 'free/gpt-6-luna'
    });
    await saveApiKey('llm_evaluator', 'gemini_eval', 'my-gateway-key');

    const check = detectProviderUrlMismatch({
      slotId: 'llm_evaluator',
      providerId: 'gemini_eval',
      baseUrl: 'https://api.apinex.bond/v1'
    });
    expect(check.mismatch).toBe(true);
    expect(check.suggestedProviderId).toBe('custom_openai_eval');

    const root = document.createElement('div');
    await bootstrapApp(root, 'settings');

    const warningBox = root.querySelector<HTMLElement>('#mismatch-warning-llm_evaluator');
    expect(warningBox).not.toBeNull();
    expect(warningBox?.style.display).not.toBe('none');
    expect(warningBox?.textContent).toContain('https://api.apinex.bond/v1');

    const switchBtn = root.querySelector<HTMLButtonElement>('#switch-custom-btn-llm_evaluator');
    expect(switchBtn).not.toBeNull();
    switchBtn?.click();

    await new Promise((r) => setTimeout(r, 30));

    const providerSelect = root.querySelector<HTMLSelectElement>('#provider-llm_evaluator');
    const baseUrlInput = root.querySelector<HTMLInputElement>('#baseurl-llm_evaluator');
    const modelInput = root.querySelector<HTMLInputElement>('#model-llm_evaluator');
    expect(providerSelect?.value).toBe('custom_openai_eval');
    expect(baseUrlInput?.value).toBe('https://api.apinex.bond/v1');
    expect(modelInput?.value).toBe('free/gpt-6-luna');
    expect(await loadApiKey('llm_evaluator', 'custom_openai_eval')).toBe('my-gateway-key');
  });
});
