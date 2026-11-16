import { Capacitor } from '@capacitor/core';
import { APP_VERSION } from '../config/appVersion';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { SLOT_DEFINITIONS, SLOT_ORDER } from '../config/providers';
import type { ConnectionTestResult, SlotId } from '../config/types';
import { loadApiKeyStrict, saveApiKey } from '../storage/keyStore';
import { loadAllSlotsConfig } from '../storage/localStore';
import { requestNativeMicPermission } from './audioRecorder';
import { testSlotConnection } from './connectionTester';
import { networkMonitor } from './networkMonitor';
import { getLastShadowingAttempt, type LastShadowingAttempt } from './shadowingTelemetry';
import { resolveGlobalTierSummary, type GlobalTierSummary } from './tierManager';

export interface DiagnosticsReport {
  timestamp: string;
  appVersion: string;
  platform: string;
  networkOnline: boolean;
  micPermissionStatus: 'granted' | 'denied' | 'prompt' | 'unavailable';
  micPermissionDetail: string;
  nativeTtsAvailable: boolean;
  nativeTtsDetail: string;
  secureKeyStoreOk: boolean;
  secureKeyStoreDetail: string;
  tierSummary: GlobalTierSummary;
  slotConnections: Record<SlotId, ConnectionTestResult>;
  lastShadowingAttempt: LastShadowingAttempt | null;
}

export async function checkMicPermission(requestIfPrompt = false): Promise<{
  status: 'granted' | 'denied' | 'prompt' | 'unavailable';
  detail: string;
}> {
  if (Capacitor.isNativePlatform()) {
    try {
      const granted = await requestNativeMicPermission();
      return granted
        ? { status: 'granted', detail: 'Android RECORD_AUDIO permission granted' }
        : { status: 'denied', detail: 'Android RECORD_AUDIO permission denied' };
    } catch {
      // Fallback to navigator check
    }
  }

  if (typeof navigator === 'undefined') {
    return { status: 'unavailable', detail: 'Navigator API unavailable' };
  }

  if (requestIfPrompt && typeof navigator.mediaDevices?.getUserMedia === 'function') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { status: 'granted', detail: 'Microphone access granted and verified' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 'denied', detail: `Microphone request denied/failed: ${msg}` };
    }
  }

  try {
    if (typeof navigator.permissions?.query === 'function') {
      const res = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (res.state === 'granted') {
        return { status: 'granted', detail: 'Microphone permission granted' };
      }
      if (res.state === 'denied') {
        return { status: 'denied', detail: 'Microphone permission denied in OS/WebView settings' };
      }
      return { status: 'prompt', detail: 'Not requested yet (tap "Request Mic" to grant)' };
    }
  } catch {
    // Permissions API not supported on some Android WebViews
  }

  if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
    return { status: 'prompt', detail: 'MediaDevices ready (tap "Request Mic" to test prompt)' };
  }

  return { status: 'unavailable', detail: 'Audio capture API unavailable in this environment' };
}

export async function checkNativeTtsAvailability(): Promise<{
  available: boolean;
  detail: string;
}> {
  try {
    const res = await TextToSpeech.getSupportedLanguages();
    const langs = Array.isArray(res?.languages) ? res.languages : [];
    const hasEn = langs.some((l) => l.toLowerCase().startsWith('en'));
    return {
      available: true,
      detail: `Native TTS ready (${langs.length} locales${hasEn ? ', English supported' : ''})`
    };
  } catch {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return {
        available: true,
        detail: 'Web SpeechSynthesis fallback available'
      };
    }
    return {
      available: false,
      detail: 'Native TTS plugin not reachable in current environment'
    };
  }
}

export async function runSecureKeyStoreSelfTest(): Promise<{
  ok: boolean;
  detail: string;
}> {
  const testSlot: SlotId = 'voice_tts';
  const testProvider = '__diag_self_test__';
  const probeValue = `diag-probe-${Date.now()}`;
  try {
    // Read all configured credentials before creating a new Keystore alias.
    // Otherwise a missing/invalidated master key could be recreated by the
    // probe write and incorrectly reported as healthy while old keys are lost.
    const configs = await loadAllSlotsConfig();
    for (const slotId of SLOT_ORDER) {
      await loadApiKeyStrict(slotId, configs[slotId].providerId);
      if (configs[slotId].secondary) {
        await loadApiKeyStrict(slotId, configs[slotId].secondary!.providerId, 'secondary');
      }
    }

    await saveApiKey(testSlot, testProvider, probeValue);
    const readBack = await loadApiKeyStrict(testSlot, testProvider);
    await saveApiKey(testSlot, testProvider, '');
    const cleared = await loadApiKeyStrict(testSlot, testProvider);

    if (readBack === probeValue && cleared === '') {
      const mode = Capacitor.isNativePlatform()
        ? 'AndroidKeyStore AES-256-GCM'
        : 'LocalPreferences fallback';
      return {
        ok: true,
        detail: `PASS — Write/Read/Clear verified (${mode})`
      };
    }
    return {
      ok: false,
      detail: `FAIL — Readback mismatch (expected "${probeValue}", got "${readBack}")`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      detail: `FAIL — KeyStore error: ${msg}`
    };
  }
}

export async function runFullDiagnostics(options?: {
  appVersion?: string;
  requestMic?: boolean;
  probeNetworkSlots?: boolean;
}): Promise<DiagnosticsReport> {
  const appVersion = options?.appVersion ?? APP_VERSION;
  const platform = Capacitor.getPlatform();
  const networkOnline = networkMonitor.isOnline();

  const [mic, tts, keyTest, configs, lastShadowingAttempt] = await Promise.all([
    checkMicPermission(Boolean(options?.requestMic)),
    checkNativeTtsAvailability(),
    runSecureKeyStoreSelfTest(),
    loadAllSlotsConfig(),
    getLastShadowingAttempt()
  ]);

  const tierSummary = await resolveGlobalTierSummary(configs, networkOnline);
  const slotConnections = {} as Record<SlotId, ConnectionTestResult>;

  for (const slotId of SLOT_ORDER) {
    const cfg = configs[slotId];
    if (options?.probeNetworkSlots) {
      slotConnections[slotId] = await testSlotConnection(cfg);
    } else {
      const resolved = tierSummary.slots[slotId];
      const def = SLOT_DEFINITIONS[slotId];
      slotConnections[slotId] = {
        ok: true,
        slotId,
        providerId: cfg.providerId,
        tier: resolved.tier,
        label: resolved.label,
        latencyMs: 0,
        message: `${def.title}: ${resolved.detailLabel}`
      };
    }
  }

  return {
    timestamp: new Date().toISOString(),
    appVersion,
    platform,
    networkOnline,
    micPermissionStatus: mic.status,
    micPermissionDetail: mic.detail,
    nativeTtsAvailable: tts.available,
    nativeTtsDetail: tts.detail,
    secureKeyStoreOk: keyTest.ok,
    secureKeyStoreDetail: keyTest.detail,
    tierSummary,
    slotConnections,
    lastShadowingAttempt
  };
}
