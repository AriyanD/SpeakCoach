import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAiShadowingSentenceBatch } from '../src/services/shadowingAiGenerator';
import { buildIeltsShadowingSlots, validateIeltsShadowingCandidates } from '../src/services/ieltsShadowingQuality';

const mocks = vi.hoisted(() => ({
  calls: 0,
  batches: [] as Array<Array<any> | Error>,
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

  it('generates the English IELTS 6/6/8 answer set in one request', async () => {
    const slots = buildIeltsShadowingSlots();
    const texts = [
      'On Monday, I joined a neighbourhood repair workshop where a patient volunteer showed me how to mend a damaged bicycle chain safely.',
      'Last summer, I spent an afternoon exploring a coastal path and learned why local residents protect its fragile dunes.',
      'At university, I worked with classmates on a small exhibition that explained how everyday objects can be redesigned for longer use.',
      'During winter, I visited a quiet library whose staff organised practical sessions for people learning useful digital skills.',
      'A few weeks ago, I helped my neighbour plan a low-cost garden and discovered how much careful watering matters.',
      'When I was younger, I often visited a busy market where shopkeepers remembered customers and explained where their produce came from.',
      'In my current routine, I set aside an hour for reading because it helps me examine unfamiliar ideas without distractions.',
      'Recently, I changed my commute and started cycling along a safer street, which has made the journey calmer and more predictable.',
      'At a community meeting, I listened to residents compare different plans for a shared courtyard and explain their concerns.',
      'Before a long trip, I usually prepare a simple checklist so I can pack efficiently and avoid unnecessary purchases.',
      'Last autumn, I attended a small music performance in an old hall, where the acoustics made every instrument sound distinct.',
      'Whenever I cook for friends, I choose seasonal ingredients because they are affordable and often taste considerably fresher.',
      'On my last birthday, my sister gave me a second-hand camera that encouraged me to notice overlooked details in familiar streets.',
      'During a group project, I learned to ask clearer questions because assumptions had previously caused avoidable confusion among teammates.',
      'A local museum recently displayed repaired household items, and the exhibition made me reconsider how quickly people replace useful products.',
      'When heavy rain disrupted our plans, we found an indoor workshop where participants built simple models from recycled cardboard.',
      'In the evenings, I prefer walking through the park because the slower pace helps me organise thoughts after a demanding day.',
      'Several months ago, I joined a language exchange and became more confident by discussing ordinary routines with patient conversation partners.',
      'At the weekend market, I found a handmade notebook whose recycled paper and durable binding made it worth the price.',
      'Before moving house, I donated furniture to a local reuse centre, which helped another family furnish their flat affordably.'
    ];
    const items = slots.map((slot, index) => ({
      q: slot.q, fn: slot.fn, text: texts[index], chunk: slot.question.split(/\\s+/u).slice(0, 3).join(' ')
    }));
    items.push(
      { q: slots[0].q, fn: slots[0].fn, text: 'By contrast, I learned basic woodworking at a weekend course where each participant designed a small shelf and tested its stability.', chunk: 'basic woodworking' },
      { q: slots[1].q, fn: slots[1].fn, text: 'A recent conversation with my cousin changed my view of public transport because she described the barriers faced by older passengers.', chunk: 'public transport' }
    );
    const localValidation = validateIeltsShadowingCandidates(items, slots, []);
    expect(localValidation.sentences, JSON.stringify(localValidation.rejectionReasons)).toHaveLength(20);
    mocks.batches = [items];
    const result = await generateAiShadowingSentenceBatch('ielts', 20, '', async () => ({}), 'en');
    expect(result).toHaveLength(20);
    expect(result.filter(item => item.part === 1)).toHaveLength(6);
    expect(result.filter(item => item.part === 2)).toHaveLength(6);
    expect(result.filter(item => item.part === 3)).toHaveLength(8);
    expect(result.every(item => item.question && item.seedId && item.chunk)).toBe(true);
    expect(mocks.calls).toBe(1);
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
