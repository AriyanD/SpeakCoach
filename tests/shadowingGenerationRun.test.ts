import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAiShadowingSentenceBatch } from '../src/services/shadowingAiGenerator';

const mocks = vi.hoisted(() => ({
  calls: 0,
  batches: [] as Array<Array<{ topic: string; text: string; phoneticFocus: string }> | Error>,
  primaryReady: false,
  secondaryReady: false
}));
const prefStore = vi.hoisted(() => new Map<string, string>());

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefStore.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { prefStore.set(key, value); }
  }
}));
vi.mock('../src/storage/localStore', () => ({
  loadAllSlotsConfig: async () => ({ llm_generator: { slotId: 'llm_generator', providerId: 'mock', baseUrl: 'https://mock.example/v1', modelOrVoice: 'mock-model' } })
}));
vi.mock('../src/services/tierManager', () => ({
  resolveSlotTier: async () => ({ label: 'Online AI', tier: 1 }),
  getProviderVerificationInstructions: () => 'Configure the generator provider.'
}));
vi.mock('../src/config/providers', () => ({
  getPreset: () => ({ id: 'mock', name: 'Mock Provider', defaultModelOrVoice: 'mock-model', tier: 1, requiresKey: true }),
  normalizeBaseUrl: (value: string) => value
}));
vi.mock('../src/services/apiFallback', () => ({
  getSlotAccountReadiness: async (_slot: string, account: 'primary' | 'secondary') => ({
    usable: account === 'primary' ? mocks.primaryReady : mocks.secondaryReady,
    reason: 'not configured'
  }),
  runWithSlotApiFallback: async (_slot: string, config: any, action: (config: any, key: string) => Promise<any>, options?: { preferredAccount?: 'primary' | 'secondary' }) => ({
    result: await action(config.llm_generator ?? config, 'test-key'),
    config: config.llm_generator ?? config,
    account: options?.preferredAccount ?? 'primary'
  })
}));
vi.mock('../src/services/customEndpointHelper', () => ({
  resolveWireFormat: () => 'openai',
  buildCustomEndpointRequest: () => ({ url: 'https://mock.example/v1/chat/completions', headers: {} }),
  buildGeminiEndpointRequest: () => ({ url: 'https://mock.example/generate', headers: {} })
}));
vi.mock('../src/services/httpClient', () => ({
  nativeHttpRequest: async () => {
    const batch = mocks.batches[mocks.calls++] ?? [];
    if (batch instanceof Error) throw batch;
    return { data: { choices: [{ message: { content: JSON.stringify({ sentences: batch }) } }] } };
  }
}));
vi.mock('../src/services/shadowingLanguageHistory', () => ({
  loadShadowingLanguageHistories: async () => ({ en: { easy: { sets: [] } } })
}));

const sentences: Array<{ topic: string; text: string; phoneticFocus: string }> = [
  ['Yesterday', 'Maya repaired the bicycle chain before riding home through the riverside park.'],
  ['During', 'Daniel compared two nearby cafés and chose the quieter place for a meeting.'],
  ['Before', 'Priya checked the weather forecast and packed a light waterproof jacket.'],
  ['At', 'Omar helped a visitor find the correct platform for the airport train.'],
  ['After', 'Lena borrowed a cookbook from the library for her weekend dinner.'],
  ['On', 'Marcus booked a table near the window because his parents enjoy natural light.'],
  ['Whenever', 'Sofia takes a side street that passes the old community garden when traffic builds.'],
  ['Although', 'Ethan finished the report by sending a clean digital copy after the printer jammed.'],
  ['Last', 'Aisha joined a walking group to explore quiet paths around the lake last month.'],
  ['Instead', 'Noah cycles to work when the weather stays dry and mild instead of driving.'],
  ['While', 'Grace reviewed her notes and noticed a useful detail in the final paragraph.'],
  ['By', 'Lucas had fixed the loose handle and tested the cupboard door twice by lunchtime.'],
  ['Whenever', 'Emma puts fresh flowers beside the entrance to make the room welcoming whenever guests arrive.'],
  ['To', 'Felix prepares tomorrow lunch before washing the dishes after dinner to save time.'],
  ['Since', 'Ruby called ahead and moved the appointment to half past three since the bus was delayed.'],
  ['During', 'Adam asked his colleague to explain the new booking system during the break.'],
  ['After', 'Chloe wrote a short summary so everyone could remember the agreed tasks after the meeting.'],
  ['Near', 'Ibrahim found a small shop selling locally made ceramic cups near the harbour.'],
  ['Before', 'Nina checked the windows and switched off the lights in every room before leaving.'],
  ['Although', 'Leo chose the quieter road beside the river although the route looked longer.'],
  ['On', 'Sara visits the market early to buy vegetables before the crowds arrive on weekends.'],
  ['Whenever', 'Ben sends a quick message instead of leaving people waiting whenever plans change.']
] .map(([topic, text]) => ({ topic, text, phoneticFocus: `The word "${text.split(/\s+/u)[0].replace(/[^\p{L}\p{N}]/gu, '')}"` }));

describe('Shadowing batch request budget', () => {
  beforeEach(() => {
    prefStore.clear();
    localStorage.clear();
    mocks.calls = 0;
    mocks.batches = [];
    mocks.primaryReady = false;
    mocks.secondaryReady = false;
  });

  it('returns twenty valid sentences with one request when the model over-generates by two', async () => {
    mocks.batches = [sentences];
    const result = await generateAiShadowingSentenceBatch('easy', 20, '', async () => ({}), 'en');
    expect(result).toHaveLength(20);
    expect(mocks.calls).toBe(1);
  });

  it('falls back from API 1 to API 2 within the same two-request budget', async () => {
    mocks.primaryReady = true;
    mocks.secondaryReady = true;
    mocks.batches = [new Error('API 1 unavailable'), sentences];
    const result = await generateAiShadowingSentenceBatch('easy', 20, '', async () => ({}), 'en');
    expect(result).toHaveLength(20);
    expect(mocks.calls).toBe(2);
  });

  it('keeps the under-delivery repair path and never exceeds two generation requests', async () => {
    mocks.batches = [sentences.slice(0, 10), sentences.slice(10, 20)];
    const result = await generateAiShadowingSentenceBatch('easy', 20, '', async () => ({}), 'en');
    expect(result).toHaveLength(20);
    expect(mocks.calls).toBe(2);
  });
});
