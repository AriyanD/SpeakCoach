import { normalizeBaseUrl } from '../config/providers';
import type { AllSlotsConfig, SlotConfig, SlotId } from '../config/types';
import { PROVIDER_ID_MIGRATIONS } from './providerIdMigration';

type ProviderAccount = 'primary' | 'secondary';

const GROQ_WHISPER_MODELS = new Set([
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en'
]);

const providerMigrationNotices: string[] = [];
const seenProviderMigrationNotices = new Set<string>();

function addProviderMigrationNotice(message: string): void {
  if (seenProviderMigrationNotices.has(message)) return;
  seenProviderMigrationNotices.add(message);
  providerMigrationNotices.push(message);
}

export function getProviderConfigMigrationNotices(): string[] {
  return [...providerMigrationNotices];
}

/**
 * Move only known legacy Groq Whisper selections after safely checking both
 * credential IDs. Never overwrite or delete an existing Custom key.
 */
export async function migrateLegacyGroqWhisperConfigs(
  configs: AllSlotsConfig
): Promise<Array<{ slotId: SlotId; account: ProviderAccount }>> {
  const changed: Array<{ slotId: SlotId; account: ProviderAccount }> = [];
  const { loadApiKeyStrict, saveApiKey } = await import('./keyStore');

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
        current.providerId !== migration.from ||
        normalizeBaseUrl(current.baseUrl) !== 'https://api.groq.com/openai/v1' ||
        !GROQ_WHISPER_MODELS.has(current.modelOrVoice.trim())
      ) continue;

      let oldKey = '';
      let customKey = '';
      try {
        oldKey = await loadApiKeyStrict(migration.slotId, migration.from, entry.account);
        customKey = await loadApiKeyStrict(migration.slotId, migration.to, entry.account);
      } catch {
        addProviderMigrationNotice(
          `Could not verify the saved ${entry.account === 'primary' ? 'API 1' : 'API 2'} key for ${migration.slotId}. The original provider ID and key were kept active; no credential was deleted.`
        );
        continue;
      }

      if ((oldKey && customKey && customKey !== oldKey) || (!oldKey && customKey)) {
        addProviderMigrationNotice(
          `Both legacy and Custom credentials exist for ${migration.slotId} (${entry.account === 'primary' ? 'API 1' : 'API 2'}). The original provider remains active and both saved keys were preserved; choose the intended provider manually in Settings.`
        );
        continue;
      }

      if (oldKey && !customKey) {
        try {
          await saveApiKey(migration.slotId, migration.to, oldKey, entry.account);
        } catch {
          addProviderMigrationNotice(
            `The legacy key for ${migration.slotId} could not be copied safely. The original provider ID and key remain active; no credential was deleted.`
          );
          continue;
        }
      }

      current.providerId = migration.to;
      changed.push({ slotId: migration.slotId, account: entry.account });
    }
  }

  return changed;
}
