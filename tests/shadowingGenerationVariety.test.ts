import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SHADOWING_LANGUAGES } from '../src/data/shadowingLanguages';
import { SHADOWING_LANGUAGE_PROFILES } from '../src/data/shadowingLanguageProfiles';
import { buildShadowingPrompt, estimatePromptTokens } from '../src/services/shadowingPromptBuilder';
import {
  buildVarietySlots, getVarietyMemory, openingKey, sentenceSimilarity,
  seedVarietyMemory, validateVarietyBatch
} from '../src/services/generationVariety';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    remove: async ({ key }: { key: string }) => { store.delete(key); }
  }
}));

describe('Shadowing generation variety', () => {
  beforeEach(() => { store.clear(); localStorage.clear(); });

  it('uses the 60-situation shuffled deck without replacement, including after reload', async () => {
    const foci = SHADOWING_LANGUAGE_PROFILES.en.foci;
    const first = await buildVarietySlots('en', 'easy', 22, foci);
    localStorage.clear(); // Simulate a WebView reload; Preferences retains the deck.
    const second = await buildVarietySlots('en', 'easy', 22, foci);
    const third = await buildVarietySlots('en', 'easy', 16, foci);
    const situations = [...first.slots, ...second.slots, ...third.slots].map(slot => slot.situation);
    expect(new Set(situations).size).toBe(60);
    const afterExhaustion = await buildVarietySlots('en', 'easy', 1, foci);
    expect(situations).toContain(afterExhaustion.slots[0].situation);
  });

  it('keeps memory isolated by language and level and stores compact entries', async () => {
    await seedVarietyMemory('en', 'easy', ['The train arrived late after the heavy rain.']);
    expect(await getVarietyMemory('en', 'easy')).toHaveLength(1);
    expect(await getVarietyMemory('en', 'hard')).toHaveLength(0);
    expect(await getVarietyMemory('sv', 'easy')).toHaveLength(0);
    expect((await getVarietyMemory('en', 'easy'))[0]).toMatchObject({
      openingKey: 'the train', text: 'The train arrived late after the heavy rain.'
    });
  });

  it('migrates the legacy shared English and per-language memory keys', async () => {
    localStorage.setItem('speakcoach_shadowing_recent_sentences_v1', JSON.stringify([
      'The old English memory entry remains available after migration.'
    ]));
    localStorage.setItem('speakcoach_shadowing_recent_sentences_v2.sv', JSON.stringify([
      'Den gamla svenska meningen finns kvar efter migreringen.'
    ]));
    expect((await getVarietyMemory('en', 'easy')).some(item => item.text.startsWith('The old English'))).toBe(true);
    expect((await getVarietyMemory('sv', 'hard')).some(item => item.text.startsWith('Den gamla svenska'))).toBe(true);
  });

  it('uses script-aware opening keys and similarity for Chinese and Japanese', () => {
    expect(openingKey('今天我去车站接朋友。', 'zh')).toBe('今天我');
    expect(openingKey('今日は駅で友達に会いました。', 'ja')).toBe('今日は');
    expect(sentenceSimilarity('今天我去车站接朋友。', '今天我去车站接同学。', 'zh')).toBeGreaterThan(0.5);
    expect(sentenceSimilarity('今日は駅で友達に会いました。', '今日は駅で友人に会いました。', 'ja')).toBeGreaterThan(0.5);
  });

  it('rejects repeated openings and near-duplicates locally', () => {
    const result = validateVarietyBatch([
      'The train arrived late after a sudden storm.',
      'The train arrived late because a sudden storm delayed it.',
      'The train stopped outside the station for several minutes.',
      'The train departed early after the driver changed the schedule.',
      'The train waited beside the platform while passengers checked their messages.',
      'My neighbour offered to collect the parcel after work.'
    ], 'en', []);
    expect(result.accepted).toHaveLength(3);
    expect(result.rejected).toHaveLength(3);
  });


  it('labels row columns and preserves caller-supplied original row numbers', async () => {
    const slots = await buildVarietySlots('en', 'easy', 2, SHADOWING_LANGUAGE_PROFILES.en.foci);
    const prompt = buildShadowingPrompt({
      languageCode: 'en', difficulty: 'easy', slots: slots.slots,
      avoidOpenings: [], avoidWords: [], promptVariantId: slots.promptVariantId, rowNumbers: [3, 5]
    });
    expect(prompt).toContain('Row: n|situation|speech act|grammar|words|pronunciation focus.');
    expect(prompt).toContain('3|');
    expect(prompt).toContain('5|');
    expect(prompt).toContain('"n":1');
  });

  it('builds a compact profile-aware prompt for all 15 languages and four levels', async () => {
    for (const language of SHADOWING_LANGUAGES) {
      expect(SHADOWING_LANGUAGE_PROFILES[language.code].foci.length).toBeGreaterThanOrEqual(10);
      for (const level of ['easy', 'medium', 'hard', 'ielts'] as const) {
        const slots = await buildVarietySlots(language.code, level, 22, SHADOWING_LANGUAGE_PROFILES[language.code].foci);
        const prompt = buildShadowingPrompt({
          languageCode: language.code, difficulty: level, slots: slots.slots,
          avoidOpenings: ['after work', 'near the station', 'before lunch', 'during class', 'on Friday', 'at home', 'while waiting', 'last weekend'],
          avoidWords: ['neighbour', 'delivery', 'appointment', 'garden', 'platform', 'weather', 'parcel', 'kitchen'],
          promptVariantId: slots.promptVariantId
        });
        expect(prompt).toContain(SHADOWING_LANGUAGE_PROFILES[language.code].register);
        expect(prompt).toContain(slots.slots[0].focus);
        expect(estimatePromptTokens(prompt)).toBeLessThan(600);
      }
    }
  });
});
