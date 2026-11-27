import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  createDefaultAllSlotsConfig,
  createDefaultSlotConfig,
  getPreset,
  normalizeBaseUrl,
  SLOT_ORDER
} from '../config/providers';
import type { AllSlotsConfig, ConnectionTestResult, SlotConfig, SlotId } from '../config/types';
import { clearAllRuntimeFailures, clearSlotRuntimeFailure } from '../services/tierManager';
import { clearProviderAccountHealth, createProviderVerificationFingerprint } from '../services/providerHealth';

const SLOTS_CONFIG_KEY = 'speakcoach.slots.config.v1';
const CONNECTION_TESTS_KEY = 'speakcoach.slots.connection_tests.v1';
const RECOVERY_PREFIX = 'speakcoach.storage_recovery.v1.';
const recoveryNotices: string[] = [];
const preservedCorruptValues = new Map<string, string>();

async function preserveCorruptValue(key: string, raw: string): Promise<void> {
  if (preservedCorruptValues.get(key) === raw) return;
  const recoveryKey = `${RECOVERY_PREFIX}${key}.${Date.now()}`;
  try {
    await setRawItem(recoveryKey, raw);
    preservedCorruptValues.set(key, raw);
    recoveryNotices.push(`A damaged copy of "${key}" was preserved as "${recoveryKey}". Default settings are being used until you restore or repair it.`);
    console.warn(`[SpeakCoach storage] Preserved unreadable data for ${key} as ${recoveryKey}.`);
  } catch (error) {
    recoveryNotices.push(`Could not preserve unreadable data for "${key}". Avoid saving over this section until you export any recoverable data.`);
    console.error(`[SpeakCoach storage] Could not preserve unreadable data for ${key}.`, error);
  }
}

export function getStorageRecoveryNotices(): string[] {
  return [...recoveryNotices];
}


export interface PersistedConnectionTestResult extends ConnectionTestResult {
  timestamp: number;
}

async function getRawItem(key: string): Promise<string | null> {
  try {
    const res = await Preferences.get({ key });
    if (res && typeof res.value === 'string') return res.value;
    if (Capacitor.isNativePlatform()) return null;
  } catch (error) {
    // Never read a stale browser fallback when native Preferences is unavailable.
    if (Capacitor.isNativePlatform()) {
      throw new Error(`Could not read SpeakCoach settings from Android storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  return null;
}

async function setRawItem(key: string, value: string): Promise<void> {
  try {
    await Preferences.set({ key, value });
    const saved = await Preferences.get({ key });
    if (saved?.value !== value) {
      throw new Error('The value read back from Preferences does not match the value that was saved.');
    }
  } catch (error) {
    if (Capacitor.isNativePlatform()) {
      throw new Error(`Could not save SpeakCoach settings to Android storage: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) {
        throw new Error('Could not verify the settings saved in browser storage.');
      }
      return;
    }
    throw error;
  }
  // Keep the web fallback in sync, but never treat it as a substitute for a
  // failed native write: Android reads from Preferences first.
  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value);
  }
}

export function sanitizeSlotConfig(slotId: SlotId, partial?: Partial<SlotConfig>): SlotConfig {
  const fallback = createDefaultSlotConfig(slotId);
  if (!partial) return fallback;
  const preset = getPreset(slotId, partial.providerId ?? fallback.providerId);
  const rawBaseUrl =
    typeof partial.baseUrl === 'string' && partial.baseUrl.trim().length > 0
      ? partial.baseUrl
      : preset.defaultBaseUrl;
  const rawModel =
    typeof partial.modelOrVoice === 'string' && partial.modelOrVoice.trim().length > 0
      ? partial.modelOrVoice.trim()
      : preset.defaultModelOrVoice;

  return {
    slotId,
    providerId: preset.id,
    baseUrl: normalizeBaseUrl(rawBaseUrl),
    modelOrVoice: rawModel,
    speechRate:
      slotId === 'voice_tts'
        ? typeof partial.speechRate === 'number' && partial.speechRate >= 0.5 && partial.speechRate <= 1.5
          ? partial.speechRate
          : 1.0
        : undefined,
    authStyle:
      partial.authStyle === 'custom_header' || partial.authStyle === 'query_param'
        ? partial.authStyle
        : 'bearer',
    customHeaderName:
      typeof partial.customHeaderName === 'string'
        ? partial.customHeaderName.trim()
        : undefined,
    customQueryParamName:
      typeof partial.customQueryParamName === 'string'
        ? partial.customQueryParamName.trim()
        : undefined,
    endpointPathOverride:
      typeof partial.endpointPathOverride === 'string'
        ? partial.endpointPathOverride.trim()
        : undefined,
    customTtsVoice:
      typeof partial.customTtsVoice === 'string'
        ? partial.customTtsVoice.trim()
        : undefined,
    ...(partial.secondary && typeof partial.secondary === 'object'
      ? {
          secondary: (() => {
            const secondaryPreset = getPreset(slotId, partial.secondary!.providerId);
            return {
              providerId: secondaryPreset.id,
              baseUrl: normalizeBaseUrl(partial.secondary!.baseUrl || secondaryPreset.defaultBaseUrl),
              modelOrVoice: (partial.secondary!.modelOrVoice || secondaryPreset.defaultModelOrVoice).trim(),
              authStyle: partial.secondary!.authStyle === 'custom_header' || partial.secondary!.authStyle === 'query_param'
                ? partial.secondary!.authStyle : 'bearer',
              customHeaderName: partial.secondary!.customHeaderName?.trim() || undefined,
              customQueryParamName: partial.secondary!.customQueryParamName?.trim() || undefined,
              endpointPathOverride: partial.secondary!.endpointPathOverride?.trim() || undefined,
              customTtsVoice: partial.secondary!.customTtsVoice?.trim() || undefined,
              verified: partial.secondary!.verified === true,
              ...(partial.secondary!.testResult && typeof partial.secondary!.testResult === 'object'
                ? {
                    testResult: {
                      ok: partial.secondary!.testResult.ok === true,
                      latencyMs: Number.isFinite(partial.secondary!.testResult.latencyMs)
                        ? Math.max(0, partial.secondary!.testResult.latencyMs) : 0,
                      message: typeof partial.secondary!.testResult.message === 'string'
                        ? partial.secondary!.testResult.message.slice(0, 500) : '',
                      testedAt: Number.isFinite(partial.secondary!.testResult.testedAt)
                        ? partial.secondary!.testResult.testedAt : 0,
                      verificationFingerprint: typeof partial.secondary!.testResult.verificationFingerprint === 'string'
                        ? partial.secondary!.testResult.verificationFingerprint : undefined
                    }
                  }
                : {})
            };
          })()
        }
      : {})
  };
}

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
async function migrateLegacyGroqWhisperConfigs(
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

export async function loadAllSlotsConfig(): Promise<AllSlotsConfig> {
  const defaults = createDefaultAllSlotsConfig();
  const raw = await getRawItem(SLOTS_CONFIG_KEY);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<SlotId, Partial<SlotConfig>>>;
    const result: AllSlotsConfig = { ...defaults };
    for (const slotId of SLOT_ORDER) {
      result[slotId] = sanitizeSlotConfig(slotId, parsed[slotId]);
    }

    const migratedGroqAccounts = await migrateLegacyGroqWhisperConfigs(result);
    if (migratedGroqAccounts.length > 0) {
      await setRawItem(SLOTS_CONFIG_KEY, JSON.stringify(result));
      for (const slotId of new Set(migratedGroqAccounts.map(item => item.slotId))) {
        if (migratedGroqAccounts.some(item => item.slotId === slotId && item.account === 'primary')) {
          await clearSlotConnectionTestResult(slotId);
        }
      }
      for (const item of migratedGroqAccounts) {
        await clearProviderAccountHealth(item.slotId, item.account);
        clearSlotRuntimeFailure(item.slotId);
      }
    }

    // Migrate only known built-in defaults from earlier app releases.
    // Explicit custom model choices and non-Google gateways are left untouched.
    const translation = result.llm_translation;
    const legacyTranslationDefaults = ['gemini-2.5-flash', 'gemini-flash-latest'];
    const officialGeminiEndpoint = normalizeBaseUrl(translation.baseUrl) === 'https://generativelanguage.googleapis.com/v1beta';
    let migratedTranslationModel = false;
    if (
      translation.providerId === 'gemini_translation' &&
      legacyTranslationDefaults.includes(translation.modelOrVoice) &&
      officialGeminiEndpoint
    ) {
      translation.modelOrVoice = getPreset('llm_translation', 'gemini_translation').defaultModelOrVoice;
      migratedTranslationModel = true;
    }
    const secondaryTranslation = translation.secondary;
    if (
      secondaryTranslation?.providerId === 'gemini_translation' &&
      legacyTranslationDefaults.includes(secondaryTranslation.modelOrVoice) &&
      normalizeBaseUrl(secondaryTranslation.baseUrl) === 'https://generativelanguage.googleapis.com/v1beta'
    ) {
      secondaryTranslation.modelOrVoice = getPreset('llm_translation', 'gemini_translation').defaultModelOrVoice;
      migratedTranslationModel = true;
    }
    if (migratedTranslationModel) {
      await setRawItem(SLOTS_CONFIG_KEY, JSON.stringify(result));
      await clearSlotConnectionTestResult('llm_translation');
      clearSlotRuntimeFailure('llm_translation');
    }
    return result;
  } catch {
    await preserveCorruptValue(SLOTS_CONFIG_KEY, raw);
    return defaults;
  }
}

export async function saveSlotConfig(config: SlotConfig): Promise<AllSlotsConfig> {
  const all = await loadAllSlotsConfig();
  const previousPrimary = all[config.slotId];
  const sanitized = sanitizeSlotConfig(config.slotId, config);
  all[config.slotId] = sanitized;
  await setRawItem(SLOTS_CONFIG_KEY, JSON.stringify(all));
  const primaryChanged = JSON.stringify({ ...previousPrimary, secondary: undefined }) !== JSON.stringify({ ...sanitized, secondary: undefined });
  if (primaryChanged) {
    clearSlotRuntimeFailure(config.slotId);
    await clearProviderAccountHealth(config.slotId, 'primary');
    await clearSlotConnectionTestResult(config.slotId);
  }
  return all;
}

export async function saveSecondarySlotConfig(
  slotId: SlotId,
  secondary: SlotConfig['secondary']
): Promise<void> {
  const all = await loadAllSlotsConfig();
  const previousSecondary = all[slotId].secondary;
  all[slotId] = sanitizeSlotConfig(slotId, { ...all[slotId], secondary });
  await setRawItem(SLOTS_CONFIG_KEY, JSON.stringify(all));
  const secondaryChanged = JSON.stringify(previousSecondary ?? null) !== JSON.stringify(all[slotId].secondary ?? null);
  if (secondaryChanged) {
    clearSlotRuntimeFailure(slotId);
    await clearProviderAccountHealth(slotId, 'secondary');
  }
}

export async function saveAllSlotsConfig(configs: AllSlotsConfig): Promise<void> {
  const sanitized = createDefaultAllSlotsConfig();
  for (const slotId of SLOT_ORDER) {
    sanitized[slotId] = sanitizeSlotConfig(slotId, configs[slotId]);
  }
  await setRawItem(SLOTS_CONFIG_KEY, JSON.stringify(sanitized));
  clearAllRuntimeFailures();
  await Promise.all(SLOT_ORDER.map(slotId => clearProviderAccountHealth(slotId)));
}

export async function loadAllConnectionTestResults(): Promise<
  Partial<Record<SlotId, PersistedConnectionTestResult>>
> {
  const raw = await getRawItem(CONNECTION_TESTS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Record<SlotId, PersistedConnectionTestResult>>;
  } catch {
    await preserveCorruptValue(CONNECTION_TESTS_KEY, raw);
    return {};
  }
}

export async function saveSlotConnectionTestResult(
  slotId: SlotId,
  result: ConnectionTestResult
): Promise<PersistedConnectionTestResult> {
  const all = await loadAllConnectionTestResults();
  let verificationFingerprint = result.verificationFingerprint;
  if (result.ok && !verificationFingerprint) {
    const configs = await loadAllSlotsConfig();
    if (configs[slotId].providerId === result.providerId) {
      try {
        const { loadApiKey } = await import('./keyStore');
        const apiKey = await loadApiKey(slotId, result.providerId, 'primary');
        verificationFingerprint = await createProviderVerificationFingerprint(configs[slotId], apiKey) ?? undefined;
      } catch {
        // A successful test without a readable key cannot be bound to a reusable verification.
      }
    }
  }
  const entry: PersistedConnectionTestResult = {
    ...result,
    verificationFingerprint,
    timestamp: 'timestamp' in result && typeof (result as Record<string, unknown>).timestamp === 'number'
      ? (result as unknown as { timestamp: number }).timestamp
      : Date.now()
  };
  all[slotId] = entry;
  await setRawItem(CONNECTION_TESTS_KEY, JSON.stringify(all));
  // A successful live test is the explicit recovery action for this account.
  if (result.ok) {
    const currentConfig = await loadAllSlotsConfig();
    if (currentConfig[slotId].providerId === result.providerId) {
      clearSlotRuntimeFailure(slotId);
      await clearProviderAccountHealth(slotId, 'primary');
    }
  }
  return entry;
}

export async function loadSlotConnectionTestResult(
  slotId: SlotId
): Promise<PersistedConnectionTestResult | null> {
  const all = await loadAllConnectionTestResults();
  return all[slotId] ?? null;
}

export async function clearSlotConnectionTestResult(slotId: SlotId): Promise<void> {
  const all = await loadAllConnectionTestResults();
  delete all[slotId];
  await setRawItem(CONNECTION_TESTS_KEY, JSON.stringify(all));
}
