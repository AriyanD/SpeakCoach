import { describe, expect, it } from 'vitest';
import { buildGeminiEndpointRequest } from '../src/services/customEndpointHelper';
import type { SlotConfig } from '../src/config/types';

function makeGeminiConfig(overrides: Partial<SlotConfig> = {}): SlotConfig {
  return {
    slotId: 'llm_generator',
    providerId: 'gemini_gen',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelOrVoice: 'gemini-2.5-flash',
    authStyle: 'query_param',
    ...overrides
  } as SlotConfig;
}

describe('Gemini API-key authentication', () => {
  it('always uses x-goog-api-key on official Google endpoints, including when an old config selected query auth', () => {
    const request = buildGeminiEndpointRequest({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultPath: '/models/gemini-2.5-flash:generateContent',
      apiKey: 'secret-test-key',
      slotConfig: makeGeminiConfig()
    });

    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(request.url).not.toContain('key=');
    expect(request.headers['x-goog-api-key']).toBe('secret-test-key');
  });

  it('preserves configured query authentication for third-party gateways that require it', () => {
    const request = buildGeminiEndpointRequest({
      baseUrl: 'https://gateway.example/v1beta',
      defaultPath: '/models/gemini-2.5-flash:generateContent',
      apiKey: 'secret-test-key',
      slotConfig: makeGeminiConfig({
        baseUrl: 'https://gateway.example/v1beta',
        customQueryParamName: 'api_key'
      })
    });

    expect(request.url).toBe('https://gateway.example/v1beta/models/gemini-2.5-flash:generateContent?api_key=secret-test-key');
    expect(request.headers['x-goog-api-key']).toBeUndefined();
  });
});
