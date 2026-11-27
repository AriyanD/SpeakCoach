import type { SlotId } from './types';

export type QuickSetupSource = 'gemini' | 'groq';

export interface QuickSetupProvider {
  providerId: string;
  source: QuickSetupSource;
  baseUrl?: string;
  model?: string;
}

export interface QuickSetupPlanItem {
  slotId: SlotId;
  primary: QuickSetupProvider;
  secondary?: QuickSetupProvider;
}

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_LLM_MODEL = 'openai/gpt-oss-120b';

/**
 * Keep this plan independent of provider dropdown order. Quick Setup deliberately
 * keeps its existing Google/Groq allocation, regardless of UI preset ordering.
 */
export const QUICK_SETUP_PLAN: QuickSetupPlanItem[] = [
  { slotId: 'voice_tts', primary: { providerId: 'gemini_tts', source: 'gemini' } },
  {
    slotId: 'pronunciation_scoring',
    primary: { providerId: 'gemini_pronunciation', source: 'gemini' },
    secondary: { providerId: 'custom_openai_pronunciation', source: 'groq' }
  },
  {
    slotId: 'ielts_stt',
    primary: { providerId: 'gemini_stt', source: 'gemini' },
    secondary: { providerId: 'custom_openai_stt', source: 'groq' }
  },
  {
    slotId: 'llm_evaluator',
    primary: { providerId: 'custom_openai_eval', source: 'groq', baseUrl: GROQ_BASE_URL, model: GROQ_LLM_MODEL },
    secondary: { providerId: 'gemini_eval', source: 'gemini' }
  },
  {
    slotId: 'llm_generator',
    primary: { providerId: 'gemini_gen', source: 'gemini' },
    secondary: { providerId: 'custom_openai_gen', source: 'groq', baseUrl: GROQ_BASE_URL, model: GROQ_LLM_MODEL }
  },
  {
    slotId: 'llm_translation',
    primary: { providerId: 'gemini_translation', source: 'gemini' },
    secondary: { providerId: 'custom_openai_translation', source: 'groq', baseUrl: GROQ_BASE_URL, model: GROQ_LLM_MODEL }
  }
];

/**
 * Include legacy Whisper IDs only for reading keys saved by older releases.
 * New Quick Setup configurations always target the Custom Groq provider IDs.
 */
export const QUICK_SETUP_REUSABLE_PROVIDER_IDS: Record<QuickSetupSource, string[]> = {
  gemini: ['gemini_tts', 'gemini_pronunciation', 'gemini_stt', 'gemini_eval', 'gemini_gen', 'gemini_translation'],
  groq: [
    'custom_openai_pronunciation',
    'custom_openai_stt',
    'custom_openai_eval',
    'custom_openai_gen',
    'custom_openai_translation',
    'whisper_alignment',
    'whisper_stt'
  ]
};
