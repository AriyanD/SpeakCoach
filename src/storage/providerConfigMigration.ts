import type { AllSlotsConfig, SlotConfig, SlotId } from '../config/types';
import { PROVIDER_ID_MIGRATIONS } from './providerIdMigration';

type ProviderAccount = 'primary' | 'secondary';

const GROQ_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en'
]);

/**
 * Copy legacy provider credentials only after verifying the destination slot.
 * Existing Custom credentials are never overwritten, and legacy credentials
 * are never deleted by this migration.
 */
export async function migrateLegacyGroqWhisperConfigs(
  configs: AllSlotsConfig
): Promise<Array<{ slotId: SlotId; account: ProviderAccount }>> {
  const changed: Array<{ slotId: SlotId; account: ProviderAccount }> = [];
  const { loadApiKey, saveApiKey } = await import('./keyStore');

  for (const migration of PROVIDER_ID_MIGRATIONS) {
    const slotConfig = configs[migration.slotId];
    const accounts: Array<{
      account: ProviderAccount;
      config: SlotConfig | NonNullable<SlotConfig['secondary']>;
    }> = [{ account: 'primary', config: slotConfig }];
    if (slotConfig.secondary) accounts.push({ account: 'secondary', config: slotConfig.secondary });

    for (const entry of accounts) {
      const current = entry.config;
      if (
        current.providerId !== migration.to ||
        current.baseUrl.replace(/\/+$/, '') !== 'https://api.groq.com/openai/v1' ||
        !GROQ_WHISPER_MODELS.has(current.modelOrVoice.trim())
      ) continue;

      let oldKey = '';
      let customKey = '';
      try {
        oldKey = await loadApiKey(migration.slotId, migration.from, entry.account);
        customKey = await loadApiKey(migration.slotId, migration.to, entry.account);
      } catch {
        // If secure key access is unavailable, preserve both IDs and credentials.
        continue;
      }

      if (customKey && customKey !== oldKey) continue;
      if (oldKey && !customKey) {
        try {
          await saveApiKey(migration.slotId, migration.to, oldKey, entry.account);
        } catch {
          // Do not report a completed migration unless the new key is saved.
          continue;
        }
        changed.push({ slotId: migration.slotId, account: entry.account });
      }
    }
  }

  return changed;
}
