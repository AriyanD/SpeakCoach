import { normalizeBaseUrl } from '../config/providers';
import { SLOT_DEFINITIONS } from '../config/providers';
import type { SlotId } from '../config/types';

export interface ProviderIdMigrationRule {
  slotId: SlotId;
  from: string;
  to: string;
  description: string;
  matches?: (baseUrl: string, modelOrVoice: string) => boolean;
}

const GROQ_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en'
]);

const isGroqWhisperConfig = (baseUrl: string, modelOrVoice: string): boolean =>
  normalizeBaseUrl(baseUrl) === 'https://api.groq.com/openai/v1' &&
  GROQ_WHISPER_MODELS.has(modelOrVoice.trim());

/**
 * Explicit, slot-scoped provider ID migrations. Conditional migrations are
 * intentionally narrow so an OpenAI Whisper configuration is not rewritten.
 */
export const PROVIDER_ID_MIGRATIONS: readonly ProviderIdMigrationRule[] = [
  {
    slotId: 'pronunciation_scoring',
    from: 'whisper_alignment',
    to: 'custom_openai_pronunciation',
    description: 'Move the former Groq Whisper alignment preset to Custom STT.',
    matches: isGroqWhisperConfig
  },
  {
    slotId: 'ielts_stt',
    from: 'whisper_stt',
    to: 'custom_openai_stt',
    description: 'Move the former Groq Whisper transcription preset to Custom STT.',
    matches: isGroqWhisperConfig
  }
];

export function resolveMigratedProviderId(
  slotId: SlotId,
  providerId: string,
  baseUrl: string,
  modelOrVoice: string
): string {
  const rule = PROVIDER_ID_MIGRATIONS.find((entry) =>
    entry.slotId === slotId &&
    entry.from === providerId &&
    (!entry.matches || entry.matches(baseUrl, modelOrVoice))
  );
  return rule?.to ?? providerId;
}

export function isKnownProviderId(slotId: SlotId, providerId: string): boolean {
  return SLOT_DEFINITIONS[slotId].providers.some((provider) => provider.id === providerId);
}
