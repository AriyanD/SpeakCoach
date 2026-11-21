import { getOfflinePreset, getPreset, SLOT_DEFINITIONS, SLOT_ORDER } from '../config/providers';
import type {
  AllSlotsConfig,
  ResolvedSlotTier,
  SlotConfig,
  SlotId,
  TierLabel,
  TierNumber
} from '../config/types';
import { hasConfiguredApiKey, loadApiKey } from '../storage/keyStore';
import { loadAllSlotsConfig, loadSlotConnectionTestResult } from '../storage/localStore';
import { networkMonitor } from './networkMonitor';
import { createProviderVerificationFingerprint, getProviderAccountHealth } from './providerHealth';

export interface GlobalTierSummary {
  label: TierLabel;
  onlineSlotsCount: number;
  totalSlotsCount: number;
  isOnlineNetwork: boolean;
  slots: Record<SlotId, ResolvedSlotTier>;
}

export const RUNTIME_FAILURE_TTL_MS = 3 * 60 * 1000; // 3 minutes
export const CONNECTION_VERIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SlotRuntimeFailureEntry {
  reason: string;
  at: number;
  status?: number;
  sticky: boolean;
}

const slotRuntimeFailures = new Map<SlotId, SlotRuntimeFailureEntry>();

export function isStickyAuthFailure(errOrStatusOrMsg?: unknown): boolean {
  if (typeof errOrStatusOrMsg === 'number') {
    return errOrStatusOrMsg === 401 || errOrStatusOrMsg === 403;
  }
  if (
    errOrStatusOrMsg &&
    typeof errOrStatusOrMsg === 'object' &&
    'status' in errOrStatusOrMsg
  ) {
    const st = (errOrStatusOrMsg as { status?: unknown }).status;
    if (st === 401 || st === 403) return true;
  }
  const text =
    errOrStatusOrMsg instanceof Error
      ? errOrStatusOrMsg.message
      : typeof errOrStatusOrMsg === 'string'
        ? errOrStatusOrMsg
        : '';
  return /\bHTTP\s*(401|403)\b/i.test(text) || /\b(401|403)\b/.test(text);
}

export function markSlotRuntimeFailure(
  slotId: SlotId,
  reason: string,
  options?: { status?: number; at?: number; sticky?: boolean }
): void {
  const sticky =
    options?.sticky ??
    (isStickyAuthFailure(options?.status) || isStickyAuthFailure(reason));
  if (!sticky) {
    // Only 401/403 auth errors are sticky; transient errors (429/5xx/timeouts) do not stick
    return;
  }
  slotRuntimeFailures.set(slotId, {
    reason,
    at: options?.at ?? Date.now(),
    status: options?.status,
    sticky: true
  });
}

export function getActiveSlotRuntimeFailure(
  slotId: SlotId,
  nowMs = Date.now()
): SlotRuntimeFailureEntry | null {
  const entry = slotRuntimeFailures.get(slotId);
  if (!entry) return null;
  if (!entry.sticky || nowMs - entry.at >= RUNTIME_FAILURE_TTL_MS) {
    slotRuntimeFailures.delete(slotId);
    return null;
  }
  return entry;
}

export function clearSlotRuntimeFailure(slotId: SlotId): void {
  slotRuntimeFailures.delete(slotId);
}

export function clearAllRuntimeFailures(): void {
  slotRuntimeFailures.clear();
}

/** Tier 1 and Tier 2 are both online; only Tier 3 is offline. */
export function isOnlineIeltsSttTier(tier: number, label: string): boolean {
  return tier < 3 && label === 'Online AI';
}

function tierToLabel(tier: TierNumber): TierLabel {
  return tier === 3 ? 'Basic offline' : 'Online AI';
}

/**
 * User-facing steps shown when an AI feature is blocked because its provider
 * has not passed the connection test. This is guidance only; verification
 * requirements remain enforced by the existing tier and fallback checks.
 */
export function getProviderVerificationInstructions(slotId: SlotId): string {
  const slotTitle = SLOT_DEFINITIONS[slotId].title.replace(/^\d+\.\s*/, '');
  return `Open Settings → ${slotTitle}, select a provider, and enter its API key. Then tap “Test API 1” and wait for a successful PASS result before using AI. If you configured a secondary provider, test it separately with “Test API 2”.`;
}

export async function resolveSlotTier(
  slotConfig: SlotConfig,
  options?: {
    isOnline?: boolean;
    hasKeyOverride?: boolean;
    nowMs?: number;
  }
): Promise<ResolvedSlotTier> {
  const slotId = slotConfig.slotId;
  const selectedPreset = getPreset(slotId, slotConfig.providerId);
  const offlinePreset = getOfflinePreset(slotId);
  const online = options?.isOnline ?? networkMonitor.isOnline();

  // Explicitly chosen Tier 3 offline provider
  if (selectedPreset.tier === 3) {
    return {
      slotId,
      providerId: selectedPreset.id,
      providerName: selectedPreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: `Basic offline (Tier 3 · ${selectedPreset.name})`,
      isFallback: false
    };
  }

  // Airplane mode / no network connectivity -> auto-fallback to Tier 3
  if (!online) {
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: 'Basic offline (Airplane mode / No internet -> Tier 3 fallback)',
      isFallback: true,
      reason: 'No internet connection'
    };
  }

  // Missing API key -> auto-fallback to Tier 3
  const hasKey =
    options?.hasKeyOverride !== undefined
      ? options.hasKeyOverride
      : selectedPreset.requiresKey
        ? await hasConfiguredApiKey(slotId, selectedPreset.id)
        : true;
  const secondaryPreset = slotConfig.secondary
    ? getPreset(slotId, slotConfig.secondary.providerId)
    : undefined;
  let secondaryReady = false;
  if (slotConfig.secondary?.verified && secondaryPreset && secondaryPreset.tier !== 3) {
    const secondaryKey = secondaryPreset.requiresKey
      ? await loadApiKey(slotId, secondaryPreset.id, 'secondary')
      : '';
    const secondaryFingerprint = await createProviderVerificationFingerprint(
      { slotId, ...slotConfig.secondary }, secondaryKey
    );
    const secondaryTest = slotConfig.secondary.testResult;
    secondaryReady = secondaryTest?.ok === true && !!secondaryFingerprint && !!secondaryTest.verificationFingerprint &&
      secondaryTest.verificationFingerprint === secondaryFingerprint &&
      Number.isFinite(secondaryTest.testedAt) && Date.now() - secondaryTest.testedAt < CONNECTION_VERIFICATION_TTL_MS &&
      (!secondaryPreset.requiresKey || !!secondaryKey.trim());
  }

  if (selectedPreset.requiresKey && !hasKey && !secondaryReady) {
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: 'Basic offline (No API key configured -> Tier 3 fallback)',
      isFallback: true,
      reason: 'No API key configured'
    };
  }

  // Missing base URL -> auto-fallback to Tier 3
  const hasBaseUrl =
    typeof slotConfig.baseUrl === 'string' && slotConfig.baseUrl.trim().length > 0;
  if (!hasBaseUrl) {
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: 'Basic offline (No base URL configured -> Tier 3 fallback)',
      isFallback: true,
      reason: 'No base URL configured'
    };
  }

  // Missing model/voice -> auto-fallback to Tier 3
  const hasModel =
    typeof slotConfig.modelOrVoice === 'string' && slotConfig.modelOrVoice.trim().length > 0;
  if (!hasModel) {
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: 'Basic offline (No model configured -> Tier 3 fallback)',
      isFallback: true,
      reason: 'No model configured'
    };
  }

  // An online provider is not considered active until the user saves its
  // configuration and a test succeeds for that exact provider.
  const verification = await loadSlotConnectionTestResult(slotId);
  const primaryKey = selectedPreset.requiresKey ? await loadApiKey(slotId, selectedPreset.id, 'primary') : '';
  const currentFingerprint = await createProviderVerificationFingerprint(slotConfig, primaryKey);
  const primaryVerified = !!verification && verification.ok &&
    verification.providerId === selectedPreset.id && verification.tier === selectedPreset.tier &&
    !!currentFingerprint && verification.verificationFingerprint === currentFingerprint &&
    Date.now() - verification.timestamp < CONNECTION_VERIFICATION_TTL_MS &&
    (!selectedPreset.requiresKey || !!primaryKey.trim());
  const primaryHealth = await getProviderAccountHealth(slotId, 'primary', options?.nowMs);
  const secondaryHealth = secondaryReady ? await getProviderAccountHealth(slotId, 'secondary', options?.nowMs) : null;
  const primaryUsable = primaryVerified && !primaryHealth;
  const secondaryUsable = secondaryReady && !secondaryHealth;

  if (!primaryUsable && !secondaryUsable && (primaryHealth || secondaryHealth)) {
    const blocked = [
      primaryHealth ? { account: 'API 1', provider: getPreset(slotId, slotConfig.providerId).name, health: primaryHealth } : null,
      secondaryHealth && slotConfig.secondary ? { account: 'API 2', provider: getPreset(slotId, slotConfig.secondary.providerId).name, health: secondaryHealth } : null
    ].filter((entry): entry is { account: string; provider: string; health: NonNullable<typeof primaryHealth> } => Boolean(entry));
    const needsRetest = blocked.some(entry => entry.health.state === 'needs-retest');
    const details = blocked.map(entry => {
      if (entry.health.state === 'needs-retest') return `${entry.account} (${entry.provider}; ${entry.health.reason}) needs a successful re-test`;
      const seconds = Math.max(1, Math.ceil(((entry.health.cooldownUntil ?? Date.now()) - (options?.nowMs ?? Date.now())) / 1000));
      return `${entry.account} (${entry.provider}; ${entry.health.reason}) is cooling down for about ${seconds}s`;
    }).join('; ');
    const reason = needsRetest
      ? `${details}. Open Settings → Voice/TTS and re-test the affected API, or configure API 2.`
      : `${details}. Wait for cooldown to expire or use the alternate API.`;
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: `Basic offline (${reason})`,
      isFallback: true,
      reason
    };
  }

  if (!primaryUsable && !secondaryUsable) {
    const now = options?.nowMs ?? Date.now();
    const primaryVerificationStale = !!verification?.ok && (
      verification.providerId !== selectedPreset.id ||
      verification.tier !== selectedPreset.tier ||
      !currentFingerprint ||
      verification.verificationFingerprint !== currentFingerprint ||
      now - verification.timestamp >= CONNECTION_VERIFICATION_TTL_MS
    );
    const secondaryConfig = slotConfig.secondary;
    const secondaryTest = secondaryConfig?.testResult;
    const secondaryVerificationStale = !!secondaryConfig?.verified && !!secondaryTest?.ok && (
      !secondaryPreset ||
      secondaryTest.verificationFingerprint !== await createProviderVerificationFingerprint(
        { slotId, ...secondaryConfig },
        secondaryPreset.requiresKey ? await loadApiKey(slotId, secondaryPreset.id, 'secondary') : ''
      ) ||
      now - secondaryTest.testedAt >= CONNECTION_VERIFICATION_TTL_MS
    );
    const staleAccounts = [
      primaryVerificationStale ? `API 1 (${selectedPreset.name})` : '',
      secondaryVerificationStale && secondaryPreset ? `API 2 (${secondaryPreset.name})` : ''
    ].filter(Boolean);
    const reason = staleAccounts.length
      ? `${staleAccounts.join(' and ')} verification expired or no longer matches the saved key/provider/model/voice. Re-test the affected API in Settings → Voice/TTS. ${getProviderVerificationInstructions(slotId)}`
      : `Provider has not passed a successful test. ${getProviderVerificationInstructions(slotId)}`;
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: `Basic offline (${reason})`,
      isFallback: true,
      reason
    };
  }

  // Runtime fallback triggered when an online request failed with a sticky auth error (401/403) that hasn't expired
  const runtimeFailure = getActiveSlotRuntimeFailure(slotId, options?.nowMs);
  if (runtimeFailure) {
    return {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: `Basic offline (Auto-fallback: ${runtimeFailure.reason})`,
      isFallback: true,
      reason: runtimeFailure.reason
    };
  }

  const label = tierToLabel(selectedPreset.tier);
  const degradedAccount = primaryHealth
    ? { account: 'API 1', provider: getPreset(slotId, slotConfig.providerId).name, health: primaryHealth }
    : secondaryHealth && slotConfig.secondary
      ? { account: 'API 2', provider: getPreset(slotId, slotConfig.secondary.providerId).name, health: secondaryHealth }
      : null;
  const accountHealthReason = degradedAccount
    ? degradedAccount.health.state === 'needs-retest'
      ? `${degradedAccount.account} (${degradedAccount.provider}) needs a successful connection re-test; the alternate account is available.`
      : `${degradedAccount.account} (${degradedAccount.provider}) is cooling down after a temporary provider failure; the alternate account is available.`
    : !primaryUsable && secondaryUsable
      ? `API 1 (${selectedPreset.name}) verification is missing, expired, or no longer matches the saved key/provider/model/voice. API 2 is being used; re-test API 1 in Settings → Voice/TTS.`
      : undefined;
  return {
    slotId,
    providerId: selectedPreset.id,
    providerName: selectedPreset.name,
    tier: selectedPreset.tier,
    label,
    detailLabel: `${label} (Tier ${selectedPreset.tier} · ${selectedPreset.name})`,
    isFallback: false,
    reason: accountHealthReason
  };
}

export async function resolveGlobalTierSummary(
  configsOverride?: AllSlotsConfig,
  isOnlineOverride?: boolean
): Promise<GlobalTierSummary> {
  const configs = configsOverride ?? (await loadAllSlotsConfig());
  const isOnline = isOnlineOverride ?? networkMonitor.isOnline();

  const slots = {} as Record<SlotId, ResolvedSlotTier>;
  let onlineSlotsCount = 0;

  for (const slotId of SLOT_ORDER) {
    const resolved = await resolveSlotTier(configs[slotId], { isOnline });
    slots[slotId] = resolved;
    if (resolved.label === 'Online AI') {
      onlineSlotsCount++;
    }
  }

  const label: TierLabel = onlineSlotsCount > 0 && isOnline ? 'Online AI' : 'Basic offline';

  return {
    label,
    onlineSlotsCount,
    totalSlotsCount: SLOT_ORDER.length,
    isOnlineNetwork: isOnline,
    slots
  };
}

export async function executeWithTierFallback<T>(
  slotId: SlotId,
  onlineAction: (tier: ResolvedSlotTier) => Promise<T>,
  offlineFallbackAction: (tier: ResolvedSlotTier) => Promise<T>
): Promise<{ result: T; activeTier: ResolvedSlotTier }> {
  const configs = await loadAllSlotsConfig();
  const resolved = await resolveSlotTier(configs[slotId]);

  if (resolved.tier === 3) {
    const result = await offlineFallbackAction(resolved);
    return { result, activeTier: resolved };
  }

  try {
    const result = await onlineAction(resolved);
    clearSlotRuntimeFailure(slotId);
    return { result, activeTier: resolved };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Online provider error';
    const status =
      err && typeof err === 'object' && 'status' in err && typeof (err as { status?: unknown }).status === 'number'
        ? (err as { status: number }).status
        : undefined;
    if (isStickyAuthFailure(err) || isStickyAuthFailure(msg)) {
      markSlotRuntimeFailure(slotId, msg, { status, sticky: true });
    }
    const offlinePreset = getOfflinePreset(slotId);
    const fallbackTier: ResolvedSlotTier = {
      slotId,
      providerId: offlinePreset.id,
      providerName: offlinePreset.name,
      tier: 3,
      label: 'Basic offline',
      detailLabel: `Basic offline (Auto-fallback: ${msg})`,
      isFallback: true,
      reason: msg
    };
    const result = await offlineFallbackAction(fallbackTier);
    return { result, activeTier: fallbackTier };
  }
}
