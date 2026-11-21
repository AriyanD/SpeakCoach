import { createDefaultSlotConfig, SLOT_DEFINITIONS, SLOT_ORDER } from '../config/providers';
import { saveBackupFile } from './nativeBackupExport';
import type { AllSlotsConfig, SlotId } from '../config/types';
import {
  loadAllSlotsConfig,
  saveAllSlotsConfig,
  clearSlotConnectionTestResult,
  loadAllConnectionTestResults,
  saveSlotConnectionTestResult,
  sanitizeSlotConfig
} from '../storage/localStore';
import { loadAppSettings, saveAppSettings } from '../storage/appSettings';
import { loadApiKeyStrict, saveApiKey } from '../storage/keyStore';
import { exportIeltsHistorySnapshot, importIeltsHistorySnapshot } from '../storage/ieltsHistoryStore';
import { SEEN_LLM_TOPICS_KEY, RECENT_LLM_QUESTIONS_KEY, getSeenQuestions, getRecentLlmQuestions, restoreLlmGenerationMemory, saveSeenQuestions } from './ieltsQuestionTracker';
import { getLastShadowingAttempt, restoreLastShadowingAttempt } from './shadowingTelemetry';
import { exportIeltsQuestionSetSnapshot, importIeltsQuestionSetSnapshot } from './ieltsQuestionSetStore';
import { clearActiveShadowingAudioStore } from './shadowingAudioStore';

export type BackupKind = 'ai-settings' | 'test-data';
const BACKUP_VERSION = 2;

export async function createBackup(
  kind: BackupKind,
  options: { includeApiKeys?: boolean } = {}
): Promise<Record<string, unknown>> {
  if (kind === 'ai-settings') {
    const configs = await loadAllSlotsConfig();
    const apiKeys = options.includeApiKeys === false
      ? undefined
      : await (async () => {
          const keys: Record<string, { primary: string; secondary?: string }> = {};
          for (const slotId of SLOT_ORDER) {
            const config = configs[slotId];
            keys[slotId] = {
              primary: await loadApiKeyStrict(slotId, config.providerId),
              ...(config.secondary ? { secondary: await loadApiKeyStrict(slotId, config.secondary.providerId, 'secondary') } : {})
            };
          }
          return keys;
        })();
    return {
      app: 'SpeakCoach',
      type: 'ai-settings',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      configs,
      ...(apiKeys ? { apiKeys } : {}),
      appSettings: await loadAppSettings()
    };
  }

  return {
    app: 'SpeakCoach',
    type: 'test-data',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ielts: await exportIeltsHistorySnapshot(),
    ieltsQuestionSets: exportIeltsQuestionSetSnapshot(),
    seenQuestions: getSeenQuestions(),
    seenLlmTopics: typeof localStorage !== 'undefined'
      ? JSON.parse(localStorage.getItem(SEEN_LLM_TOPICS_KEY) || '[]')
      : [],
    seenLlmQuestions: getRecentLlmQuestions(),
    lastShadowingAttempt: await getLastShadowingAttempt()
  };
}

/**
 * Accepts the current format and older unversioned app backups.
 * Versioned backups from a newer app are rejected rather than partially imported.
 */
export function normalizeBackupPayload(payload: unknown, kind: BackupKind): Record<string, any> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The selected file does not contain a SpeakCoach backup object.');
  }
  const raw = payload as Record<string, any>;
  const inferredType = raw.type ?? (
    raw.configs || Array.isArray(raw.apiKeys) ? 'ai-settings' :
    raw.ielts || raw.ieltsQuestionSets || raw.seenQuestions || raw.seenLlmQuestions || raw.lastShadowingAttempt !== undefined ? 'test-data' : undefined
  );
  const acceptedAppIds = new Set(['SpeakCoach']);
  if (raw.app !== undefined && !acceptedAppIds.has(String(raw.app))) {
    throw new Error('This backup belongs to a different app.');
  }
  if (inferredType !== kind) {
    throw new Error(`This is not a SpeakCoach ${kind === 'ai-settings' ? 'AI settings' : 'test data'} backup.`);
  }
  const version = raw.version === undefined || raw.version === null ? 0 : Number(raw.version);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error('The backup has an invalid version number.');
  }
  if (version > BACKUP_VERSION) {
    throw new Error('This backup was created by a newer SpeakCoach version. Update the app before importing it.');
  }
  return { ...raw, app: 'SpeakCoach', type: kind, version: BACKUP_VERSION };
}

export function parseBackupJsonText(text: string): unknown {
  let source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('The selected backup file is empty.');
  if (source.startsWith('```')) {
    source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parsing error';
    throw new Error(`Could not parse this backup as JSON (${message}). Check that the file is a complete .json backup exported by SpeakCoach.`);
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed.replace(/^\uFEFF/, '').trim());
    } catch {
      throw new Error('The file contains JSON text inside a string, but the inner backup data is invalid.');
    }
  }
  return parsed;
}

interface ApiKeySnapshot {
  slotId: SlotId;
  providerId: string;
  account: 'primary' | 'secondary';
  value: string;
}

function uniqueKeyTargets(configs: AllSlotsConfig): ApiKeySnapshot[] {
  const targets = new Map<string, Omit<ApiKeySnapshot, 'value'>>();
  for (const slotId of SLOT_ORDER) {
    const config = configs[slotId];
    const primary = { slotId, providerId: config.providerId, account: 'primary' as const };
    targets.set(`${slotId}|${config.providerId}|primary`, primary);
    if (config.secondary) {
      const secondary = { slotId, providerId: config.secondary.providerId, account: 'secondary' as const };
      targets.set(`${slotId}|${config.secondary.providerId}|secondary`, secondary);
    }
  }
  return Array.from(targets.values()).map(target => ({ ...target, value: '' }));
}

function validateAiSettingsBackup(payload: Record<string, any>): {
  incoming: Partial<AllSlotsConfig>;
  keys?: Record<string, { primary: string; secondary?: string }>;
  appSettings?: { theme?: 'system' | 'light' | 'dark' };
} {
  const rawIncoming = payload.configs as Partial<AllSlotsConfig> | undefined;
  if (!rawIncoming || typeof rawIncoming !== 'object' || Array.isArray(rawIncoming)) {
    throw new Error('The backup does not contain provider settings.');
  }
  const incoming: Partial<AllSlotsConfig> = { ...rawIncoming };
  // Version 1 backups predate the independent translator slot. Migrate them
  // by adding its untouched default config instead of rejecting the whole backup.
  if (!incoming.llm_translation) incoming.llm_translation = createDefaultSlotConfig('llm_translation');

  for (const slotId of SLOT_ORDER) {
    const slot = incoming[slotId];
    if (!slot || typeof slot !== 'object') {
      throw new Error(`The backup is missing the "${slotId}" provider settings. No settings were imported.`);
    }
    if (!SLOT_DEFINITIONS[slotId].providers.some(provider => provider.id === slot.providerId)) {
      throw new Error(`The backup contains an unsupported provider for "${slotId}". No settings were imported.`);
    }
    if (slot.secondary && !SLOT_DEFINITIONS[slotId].providers.some(provider => provider.id === slot.secondary!.providerId)) {
      throw new Error(`The backup contains an unsupported secondary provider for "${slotId}". No settings were imported.`);
    }
  }

  let keys: Record<string, { primary: string; secondary?: string }> | undefined;
  if (payload.apiKeys !== undefined) {
    if (!payload.apiKeys || typeof payload.apiKeys !== 'object' || Array.isArray(payload.apiKeys)) {
      throw new Error('The backup API key section is invalid. No settings or API keys were imported.');
    }
    const keyMap = { ...(payload.apiKeys as Record<string, { primary: string; secondary?: string }>) };
    // Older backups contain no translator credential; leave its new key empty.
    if (!keyMap.llm_translation) keyMap.llm_translation = { primary: '' };
    keys = keyMap;
    for (const slotId of SLOT_ORDER) {
      const entry = keyMap[slotId];
      if (!entry || typeof entry !== 'object' || typeof entry.primary !== 'string') {
        throw new Error(`The backup is missing the API key entry for "${slotId}". No settings or API keys were imported.`);
      }
      if (incoming[slotId]!.secondary && typeof entry.secondary !== 'string') {
        throw new Error(`The backup is missing the secondary API key for "${slotId}". No settings or API keys were imported.`);
      }
    }
  }

  let appSettings: { theme?: 'system' | 'light' | 'dark' } | undefined;
  if (payload.appSettings !== undefined) {
    if (!payload.appSettings || typeof payload.appSettings !== 'object' || Array.isArray(payload.appSettings)) {
      throw new Error('The backup app settings section is invalid. No settings were imported.');
    }
    const raw = payload.appSettings;
    if (raw.theme !== undefined && !['system', 'light', 'dark'].includes(raw.theme)) {
      throw new Error('The backup contains an invalid appearance preference. No settings were imported.');
    }
    appSettings = {
      ...(raw.theme !== undefined ? { theme: raw.theme } : {})
    };
  }

  return { incoming, keys, appSettings };
}

/**
 * AI settings restore is transactional at the application level:
 * validate everything first, snapshot current state, verify every write, and
 * attempt to restore the snapshot if any part of the import fails.
 * Legacy backups without apiKeys remain supported and never clear existing keys.
 */
export async function restoreBackup(kind: BackupKind, payload: any): Promise<void> {
  payload = normalizeBackupPayload(payload, kind);
  if (kind === 'ai-settings') {
    const validated = validateAiSettingsBackup(payload);
    const current = await loadAllSlotsConfig();
    const currentAppSettings = await loadAppSettings();
    const previousConnectionResults = await loadAllConnectionTestResults();

    const merged = { ...current } as AllSlotsConfig;
    for (const slotId of SLOT_ORDER) {
      const slot = validated.incoming[slotId]!;
      merged[slotId] = {
        ...current[slotId],
        ...slot,
        slotId,
        secondary: slot.secondary ? { ...slot.secondary, verified: false } : undefined
      };
    }

    const keyTargets = validated.keys
      ? uniqueKeyTargets(current).concat(uniqueKeyTargets(merged))
          .filter((target, index, all) => all.findIndex(item =>
            item.slotId === target.slotId && item.providerId === target.providerId && item.account === target.account
          ) === index)
      : [];
    const keySnapshot: ApiKeySnapshot[] = [];
    for (const target of keyTargets) {
      keySnapshot.push({
        ...target,
        value: await loadApiKeyStrict(target.slotId, target.providerId, target.account)
      });
    }

    try {
      // Write keys first. A config must never point at a key that has not been
      // securely persisted and read back successfully.
      if (validated.keys) {
        for (const slotId of SLOT_ORDER) {
          const entry = validated.keys[slotId];
          const primaryProviderId = merged[slotId].providerId;
          await saveApiKey(slotId, primaryProviderId, entry.primary);
          if (await loadApiKeyStrict(slotId, primaryProviderId) !== entry.primary.trim()) {
            throw new Error(`Could not verify the API key for "${slotId}" after restoring it.`);
          }
          const secondary = merged[slotId].secondary;
          if (secondary) {
            await saveApiKey(slotId, secondary.providerId, entry.secondary!, 'secondary');
            if (await loadApiKeyStrict(slotId, secondary.providerId, 'secondary') !== entry.secondary!.trim()) {
              throw new Error(`Could not verify the secondary API key for "${slotId}" after restoring it.`);
            }
          }
        }
      }

      await saveAllSlotsConfig(merged);
      const persisted = await loadAllSlotsConfig();
      for (const slotId of SLOT_ORDER) {
        const expected = sanitizeSlotConfig(slotId, merged[slotId]);
        if (JSON.stringify(persisted[slotId]) !== JSON.stringify(expected)) {
          throw new Error(`The "${slotId}" settings could not be verified after saving.`);
        }
      }

      if (validated.appSettings) {
        await saveAppSettings(validated.appSettings);
        const saved = await loadAppSettings();
        if (validated.appSettings.theme !== undefined && saved.theme !== validated.appSettings.theme) {
          throw new Error('The appearance preference could not be verified after import.');
        }
      }

      // Imported provider configurations must be tested again; never restore a
      // stale "connected" badge from the source device.
      for (const slotId of SLOT_ORDER) await clearSlotConnectionTestResult(slotId);
      // Audio is device-local derived cache, never part of a backup. Imported
      // provider credentials/configuration must not reuse previously generated files.
      await clearActiveShadowingAudioStore();
      return;
    } catch (error) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const rollbackErrors: string[] = [];
      try { await saveAllSlotsConfig(current); } catch (e) { rollbackErrors.push(`settings: ${String(e)}`); }
      try { await saveAppSettings(currentAppSettings); } catch (e) { rollbackErrors.push(`app preferences: ${String(e)}`); }
      for (const snapshot of keySnapshot) {
        try {
          await saveApiKey(snapshot.slotId, snapshot.providerId, snapshot.value, snapshot.account);
          const restored = await loadApiKeyStrict(snapshot.slotId, snapshot.providerId, snapshot.account);
          if (restored !== snapshot.value.trim()) throw new Error('read-back mismatch');
        } catch (e) {
          rollbackErrors.push(`API key for ${snapshot.slotId}/${snapshot.account}: ${String(e)}`);
        }
      }
      for (const slotId of SLOT_ORDER) {
        try {
          await clearSlotConnectionTestResult(slotId);
          const previous = previousConnectionResults[slotId];
          if (previous) await saveSlotConnectionTestResult(slotId, previous);
        } catch (e) {
          rollbackErrors.push(`connection status for ${slotId}: ${String(e)}`);
        }
      }
      const rollbackNote = rollbackErrors.length
        ? ` Rollback was incomplete: ${rollbackErrors.join('; ')}. Keep the app open and export a diagnostic backup before further changes.`
        : ' The previous settings and API keys were restored.';
      throw new Error(`AI settings import failed: ${originalMessage}.${rollbackNote}`);
    }
  }

  // Test-data restore also snapshots every affected section before the first
  // write. A failure in one section must not leave a mixed old/new history.
  const previousHistory = await exportIeltsHistorySnapshot();
  const previousQuestionSets = exportIeltsQuestionSetSnapshot();
  const previousSeenQuestions = getSeenQuestions();
  const previousSeenTopicsRaw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(SEEN_LLM_TOPICS_KEY)
    : null;
  const previousSeenLlmQuestionsRaw = typeof localStorage !== 'undefined'
    ? localStorage.getItem(RECENT_LLM_QUESTIONS_KEY)
    : null;
  const previousShadowingAttempt = await getLastShadowingAttempt();

  try {
    if (payload.ielts) await importIeltsHistorySnapshot(payload.ielts);
    if (payload.ieltsQuestionSets !== undefined) importIeltsQuestionSetSnapshot(payload.ieltsQuestionSets);
    if (payload.seenQuestions && typeof payload.seenQuestions === 'object') {
      saveSeenQuestions({
        seenPart1Ids: Array.isArray(payload.seenQuestions.seenPart1Ids) ? payload.seenQuestions.seenPart1Ids : [],
        seenCueCardIds: Array.isArray(payload.seenQuestions.seenCueCardIds) ? payload.seenQuestions.seenCueCardIds : [],
        seenPart3Ids: Array.isArray(payload.seenQuestions.seenPart3Ids) ? payload.seenQuestions.seenPart3Ids : []
      });
    }
    if (Array.isArray(payload.seenLlmTopics) || Array.isArray(payload.seenLlmQuestions)) {
      restoreLlmGenerationMemory({
        topics: Array.isArray(payload.seenLlmTopics) ? payload.seenLlmTopics : [],
        questions: Array.isArray(payload.seenLlmQuestions) ? payload.seenLlmQuestions : []
      });
    }
    if (payload.lastShadowingAttempt !== undefined) {
      await restoreLastShadowingAttempt(payload.lastShadowingAttempt ?? null);
    }
    // Test-data restore can change the user's practice context; keep generated
    // AI audio out of backups and clear the active-set files after a successful import.
    await clearActiveShadowingAudioStore();
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const rollbackErrors: string[] = [];
    try { await importIeltsHistorySnapshot(previousHistory); } catch (e) { rollbackErrors.push(`IELTS history: ${String(e)}`); }
    try { importIeltsQuestionSetSnapshot(previousQuestionSets); } catch (e) { rollbackErrors.push(`generated question sets: ${String(e)}`); }
    try { saveSeenQuestions(previousSeenQuestions); } catch (e) { rollbackErrors.push(`seen-question tracking: ${String(e)}`); }
    try {
      if (typeof localStorage !== 'undefined') {
        if (previousSeenTopicsRaw === null) localStorage.removeItem(SEEN_LLM_TOPICS_KEY);
        else localStorage.setItem(SEEN_LLM_TOPICS_KEY, previousSeenTopicsRaw);
        if (previousSeenLlmQuestionsRaw === null) localStorage.removeItem(RECENT_LLM_QUESTIONS_KEY);
        else localStorage.setItem(RECENT_LLM_QUESTIONS_KEY, previousSeenLlmQuestionsRaw);
      }
    } catch (e) { rollbackErrors.push(`seen-topic tracking: ${String(e)}`); }
    try { await restoreLastShadowingAttempt(previousShadowingAttempt); } catch (e) { rollbackErrors.push(`Shadowing attempt: ${String(e)}`); }
    throw new Error(`Test-data import failed: ${originalMessage}${rollbackErrors.length ? `. Rollback was incomplete: ${rollbackErrors.join('; ')}` : '. Your previous test data was restored.'}`);
  }
}

export async function downloadBackupFile(kind: BackupKind, payload: Record<string, unknown>): Promise<void> {
  const fileName = kind === 'ai-settings'
    ? (payload.apiKeys
      ? 'speakcoach-ai-settings-backup.json'
      : 'speakcoach-ai-settings-no-keys-backup.json')
    : 'speakcoach-test-data-backup.json';
  await saveBackupFile(fileName, JSON.stringify(payload, null, 2));
}

export async function readBackupFile(file: File): Promise<any> {
  if (!file) {
    throw new Error('No backup file was selected. Choose the SpeakCoach .json backup and try again.');
  }

  const readers: Array<() => Promise<string>> = [];
  if (typeof file.text === 'function') readers.push(() => file.text());
  if (typeof file.arrayBuffer === 'function') {
    readers.push(async () => new TextDecoder('utf-8').decode(await file.arrayBuffer()));
  }
  readers.push(() => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The browser could not read the selected file.'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    try {
      reader.readAsText(file, 'UTF-8');
    } catch (error) {
      reject(error instanceof Error ? error : new Error('The browser could not read the selected file.'));
    }
  }));

  let sawEmptyContent = false;
  let parseError: Error | undefined;
  const readErrors: string[] = [];

  for (const read of readers) {
    try {
      const contents = await read();
      if (!contents.replace(/^\uFEFF/, '').trim()) {
        sawEmptyContent = true;
        continue;
      }
      try {
        return parseBackupJsonText(contents);
      } catch (error) {
        parseError = error instanceof Error ? error : new Error('Could not read the backup file.');
      }
    } catch (error) {
      readErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (parseError) throw parseError;
  if (sawEmptyContent) {
    const fileName = file.name || 'the selected file';
    const reportedSize = Number.isFinite(file.size) ? file.size : 'unknown';
    throw new Error(
      `The selected backup file "${fileName}" was read as empty (reported size: ${reportedSize} bytes). ` +
      'Choose the actual SpeakCoach .json backup. If it is stored in cloud storage, download or copy it to your device first, then select it again.'
    );
  }

  const detail = readErrors[0] ? ` Details: ${readErrors[0]}` : '';
  throw new Error(`Could not read "${file.name || 'the selected file'}". Choose the backup again.${detail}`);
}
