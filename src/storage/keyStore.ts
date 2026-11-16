import { Capacitor, registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { SlotId } from '../config/types';
import { clearSlotRuntimeFailure } from '../services/tierManager';

export interface SecureKeyPluginInterface {
  setKey(options: { keyId: string; value: string }): Promise<{ saved: boolean }>;
  getKey(options: { keyId: string }): Promise<{ value: string }>;
}

const SecureKeyNative = registerPlugin<SecureKeyPluginInterface>('SecureKey');

const KEY_PREFIX = 'speakcoach.securekey.v1.';

function buildKeyId(slotId: SlotId, providerId: string, account: 'primary' | 'secondary' = 'primary'): string {
  return `${KEY_PREFIX}${slotId}.${providerId}${account === 'secondary' ? '.secondary' : ''}`;
}

/** Read legacy copies only for migration/recovery. They are never a native write target. */
async function readLegacyKey(keyId: string): Promise<string> {
  try {
    const result = await Preferences.get({ key: keyId });
    if (typeof result?.value === 'string' && result.value.length > 0) return result.value;
  } catch {
    // The browser fallback may still contain a key written by an older app build.
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(keyId) ?? '';
  return '';
}

/** Remove legacy plaintext copies only after a verified native Keystore write. */
async function removeLegacyCopies(keyId: string): Promise<void> {
  try {
    await Preferences.remove({ key: keyId });
  } catch {
    // The secure copy is already verified; retain no dependency on cleanup.
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(keyId);
  } catch {
    // Storage cleanup is best-effort and must not invalidate the secure copy.
  }
}

async function writeNativeKey(keyId: string, value: string): Promise<void> {
  let result: { saved: boolean };
  try {
    result = await SecureKeyNative.setKey({ keyId, value });
  } catch (error) {
    throw new Error(`Could not securely save this API key on this device: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result?.saved !== true) {
    throw new Error('Android did not confirm that the API key was saved securely. Your previous key has been kept.');
  }

  let persisted: { value: string };
  try {
    persisted = await SecureKeyNative.getKey({ keyId });
  } catch (error) {
    throw new Error(`The API key was written but could not be read back for verification. The previous backup copy was retained. ${error instanceof Error ? error.message : String(error)}`);
  }
  if ((persisted?.value ?? '') !== value) {
    throw new Error('The API key did not match after secure storage verification. The previous backup copy was retained.');
  }
}

async function writeBrowserKey(keyId: string, value: string): Promise<void> {
  try {
    if (value) await Preferences.set({ key: keyId, value });
    else await Preferences.remove({ key: keyId });
    const check = await Preferences.get({ key: keyId });
    if ((check?.value ?? '') !== value) throw new Error('Preferences read-back verification failed.');
    if (typeof localStorage !== 'undefined') {
      if (value) localStorage.setItem(keyId, value);
      else localStorage.removeItem(keyId);
    }
    return;
  } catch (error) {
    if (typeof localStorage === 'undefined') {
      throw new Error(`Could not persist the API key: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // localStorage is a browser/test-only fallback, never an Android fallback.
  if (value) localStorage.setItem(keyId, value);
  else localStorage.removeItem(keyId);
  if ((localStorage.getItem(keyId) ?? '') !== value) {
    throw new Error('Could not verify the API key in browser storage.');
  }
}

export async function saveApiKey(
  slotId: SlotId,
  providerId: string,
  apiKey: string,
  account: 'primary' | 'secondary' = 'primary'
): Promise<void> {
  const keyId = buildKeyId(slotId, providerId, account);
  const trimmed = apiKey.trim();

  if (Capacitor.isNativePlatform()) {
    // Never silently downgrade a native API-key write to plaintext Preferences
    // or localStorage. A failed secure write is reported to the Settings UI.
    await writeNativeKey(keyId, trimmed);
    await removeLegacyCopies(keyId);
  } else {
    await writeBrowserKey(keyId, trimmed);
  }

  clearSlotRuntimeFailure(slotId);
}

export async function loadApiKeyStrict(
  slotId: SlotId,
  providerId: string,
  account: 'primary' | 'secondary' = 'primary'
): Promise<string> {
  const keyId = buildKeyId(slotId, providerId, account);

  if (Capacitor.isNativePlatform()) {
    let secureReadError: unknown = null;
    try {
      const secure = await SecureKeyNative.getKey({ keyId });
      if (typeof secure?.value === 'string' && secure.value.length > 0) return secure.value;
      // Empty means no secure entry; check for keys written by older app builds.
    } catch (error) {
      secureReadError = error;
    }

    const legacy = await readLegacyKey(keyId);
    if (!legacy) {
      if (secureReadError) {
        throw new Error(`Could not read this API key from Android Keystore. The saved encrypted value may be unavailable; restore it from an AI Settings backup. ${secureReadError instanceof Error ? secureReadError.message : String(secureReadError)}`);
      }
      return '';
    }

    try {
      await writeNativeKey(keyId, legacy);
      await removeLegacyCopies(keyId);
    } catch {
      // Preserve compatibility and avoid data loss: keep the old copy in place
      // and return it for this session. A later save will report secure-write
      // failure instead of silently writing another plaintext copy.
    }
    return legacy;
  }

  try {
    const result = await Preferences.get({ key: keyId });
    if (typeof result?.value === 'string' && result.value.length > 0) return result.value;
  } catch {
    // Browser/test fallback.
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(keyId) ?? '';
  return '';
}

/**
 * Runtime reads are non-throwing so an unavailable credential cannot crash
 * app navigation. Backup/restore uses loadApiKeyStrict() to prevent silent
 * export or rollback with a missing key.
 */
export async function loadApiKey(
  slotId: SlotId,
  providerId: string,
  account: 'primary' | 'secondary' = 'primary'
): Promise<string> {
  try {
    return await loadApiKeyStrict(slotId, providerId, account);
  } catch {
    return '';
  }
}

export async function hasConfiguredApiKey(
  slotId: SlotId,
  providerId: string,
  account: 'primary' | 'secondary' = 'primary'
): Promise<boolean> {
  const key = await loadApiKey(slotId, providerId, account);
  return key.trim().length > 0;
}
