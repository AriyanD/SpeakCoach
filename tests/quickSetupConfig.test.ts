import { describe, expect, it } from 'vitest';
import {
  QUICK_SETUP_PLAN,
  QUICK_SETUP_REUSABLE_PROVIDER_IDS
} from '../src/config/quickSetup';

describe('Quick Setup provider allocation', () => {
  it('keeps the existing Google/Groq split independent of dropdown order', () => {
    expect(QUICK_SETUP_PLAN.map(item => item.slotId)).toEqual([
      'voice_tts',
      'pronunciation_scoring',
      'ielts_stt',
      'llm_evaluator',
      'llm_generator',
      'llm_translation'
    ]);

    expect(QUICK_SETUP_PLAN.map(item => [item.primary.source, item.secondary?.source ?? null])).toEqual([
      ['gemini', null],
      ['gemini', 'groq'],
      ['gemini', 'groq'],
      ['groq', 'gemini'],
      ['gemini', 'groq'],
      ['gemini', 'groq']
    ]);
  });

  it('uses the new Custom Groq Whisper IDs without changing Quick Setup key distribution', () => {
    expect(QUICK_SETUP_PLAN.find(item => item.slotId === 'pronunciation_scoring')).toMatchObject({
      primary: { providerId: 'gemini_pronunciation', source: 'gemini' },
      secondary: { providerId: 'custom_openai_pronunciation', source: 'groq' }
    });
    expect(QUICK_SETUP_PLAN.find(item => item.slotId === 'ielts_stt')).toMatchObject({
      primary: { providerId: 'gemini_stt', source: 'gemini' },
      secondary: { providerId: 'custom_openai_stt', source: 'groq' }
    });

    // Existing legacy IDs remain readable so previously saved Groq keys can be reused.
    expect(QUICK_SETUP_REUSABLE_PROVIDER_IDS.groq).toEqual([
      // Keep the original cross-slot key search order unchanged.
      'whisper_alignment',
      'whisper_stt',
      'custom_openai_eval',
      'custom_openai_gen',
      'custom_openai_translation',
      'custom_openai_pronunciation',
      'custom_openai_stt'
    ]);
    expect(QUICK_SETUP_REUSABLE_PROVIDER_IDS.gemini).toContain('gemini_eval');
  });

  it('keeps Groq LLM model settings and the evaluator primary/secondary exception unchanged', () => {
    const evaluator = QUICK_SETUP_PLAN.find(item => item.slotId === 'llm_evaluator');
    expect(evaluator).toMatchObject({
      primary: {
        providerId: 'custom_openai_eval',
        source: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b'
      },
      secondary: { providerId: 'gemini_eval', source: 'gemini' }
    });
    for (const slotId of ['llm_generator', 'llm_translation'] as const) {
      expect(QUICK_SETUP_PLAN.find(item => item.slotId === slotId)?.secondary).toMatchObject({
        source: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b'
      });
    }
  });
});
