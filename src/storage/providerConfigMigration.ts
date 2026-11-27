import { normalizeBaseUrl } from '../config/providers';
import type { AllSlotsConfig, SlotConfig, SlotId } from '../config/types';

type ProviderAccount = 'primary' | 'secondary';

const LEGACY_GROQ_WHISPER_MIGRATIONS: Array<{
  slotId: SlotId;
  oldProviderId: string;
  newProviderId: string;
}> = [
  { slotId: 'pronunciation_scoring', oldProviderId: 'whisper_alignment', newProviderId: 'custom_openai_pronunciation' },
  { slotId: 'ielts_stt', oldProviderId: 'whisper_stt', newProviderId: 'custom_openai_stt' }
];

const GROQ_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en'
]);

/**
 * Move only the known built-in Groq Whisper configuration to its new Custom
 * provider ID. Preserve user-edited endpoints/models and never overwrite an
 * already-saved Custom key with a different credential.
 */
export async function migrateLegacyGroqWhisperConfigs(
  configs: AllSlotsConfig
): Promise<Array<{ slotId: SlotId; account: ProviderAccount }>> {
  const changed: Array<{ slotId: SlotId; account: ProviderAccount }> = [];
  const { loadApiKey, saveApiKey } = await import('./keyStore');

  for (const migration of LEGACY_GROQ_WHISPER_MIGRATIONS) {
    const slotConfig = configs[migration.slotId];
    const accounts: Array<{ account: ProviderAccount; config: SlotConfig | NonNullable<SlotConfig['secondary']> }> = [
      { account: 'primary', config: slotConfig }
    ];
    if (slotConfig.secondary) accounts.push({ account: 'secondary', config: slotConfig.secondary });

    for (const entry of accounts) {
      const current = entry.config;
      if (current.providerId !== migration.oldProviderId ||
          normalizeBaseUrl(current.baseUrl) !== 'https://api.groq.com/openai/v1' ||
          !GROQ_WHISPER_MODELS.has(current.modelOrVoice.trim())) continue;

      let oldKey = '';
      let customKey = '';
      try {
        oldKey = await loadApiKey(migration.slotId, migration.oldProviderId, entry.account);
        customKey = await loadApiKey(migration.slotId, migration.newProviderId, entry.account);
      } catch {
        // If secure key access is unavailable, keep the old provider ID/config.
        continue;
      }
      if (customKey && customKey !== oldKey) continue;
      if (oldKey && !customKey) {
        try {
          await saveApiKey(migration.slotId, migration.newProviderId, oldKey, entry.account);
        } catch {
          // Do not switch provider IDs unless the old key can be copied safely.
          continue;
        }
      }

      current.providerId = migration.newProviderId;
      if (entry.account === 'secondary') {
        slotConfig.secondary = {
          ...slotConfig.secondary!,
          providerId: migration.newProviderId,
          verified: false,
          testResult: undefined
        };
      }
      changed.push({ slotId: migration.slotId, account: entry.account });
    }
  }

  return changed;
}
