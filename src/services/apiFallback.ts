import { getPreset } from '../config/providers';
import { getProviderVerificationInstructions } from './tierManager';
import type { SlotConfig, SlotId, SlotProviderConfig } from '../config/types';
import { loadApiKey } from '../storage/keyStore';
import { loadAllSlotsConfig, loadSlotConnectionTestResult } from '../storage/localStore';

export interface ApiAttemptResult<T> {
  result: T;
  config: SlotConfig;
  account: 'primary' | 'secondary';
}

/**
 * Runs a request against the primary provider and retries once with the
 * independently configured secondary provider. Secondary providers are only
 * eligible after their own Deep test has passed.
 */
export async function runWithSlotApiFallback<T>(
  slotId: SlotId,
  primaryConfig: SlotConfig,
  action: (config: SlotConfig, apiKey: string) => Promise<T>,
  options?: { preferredAccount?: 'auto' | 'primary' | 'secondary' }
): Promise<ApiAttemptResult<T>> {
  const attempts: Array<{ config: SlotConfig; account: 'primary' | 'secondary' }> = [];
  const allConfigs = await loadAllSlotsConfig();
  const primaryPreset = getPreset(slotId, primaryConfig.providerId);
  const primaryTest = await loadSlotConnectionTestResult(slotId);
  const primaryVerified = !!primaryTest?.ok && primaryTest.providerId === primaryPreset.id && primaryTest.tier === primaryPreset.tier;
  if (primaryVerified) attempts.push({ config: primaryConfig, account: 'primary' });
  const secondary = allConfigs[slotId].secondary as SlotProviderConfig | undefined;
  let secondarySkipReason = '';
  if (secondary?.verified) {
    const secondaryConfig: SlotConfig = { slotId, ...secondary };
    if (getPreset(slotId, secondaryConfig.providerId).tier !== 3) {
      attempts.push({ config: secondaryConfig, account: 'secondary' });
    } else {
      secondarySkipReason = 'API 2 is configured as an offline provider and cannot be used as an online fallback.';
    }
  } else if (secondary) {
    secondarySkipReason = secondary.testResult?.message
      ? `API 2 has not passed its connection test: ${secondary.testResult.message}`
      : 'API 2 is saved but not verified. Run Test API 2 successfully; its verified state must be retained when saving settings.';
  }

  const preferredAccount = options?.preferredAccount ?? 'auto';
  const selectedAttempts = preferredAccount === 'auto'
    ? attempts
    : attempts.filter((attempt) => attempt.account === preferredAccount);

  const errors: string[] = [];
  if (selectedAttempts.length === 0) {
    throw new Error(`No verified AI provider is ready for this feature. ${getProviderVerificationInstructions(slotId)}`);
  }
  for (const attempt of selectedAttempts) {
    const preset = getPreset(slotId, attempt.config.providerId);
    try {
      const apiKey = preset.requiresKey
        ? await loadApiKey(slotId, attempt.config.providerId, attempt.account)
        : '';
      if (preset.requiresKey && !apiKey.trim()) {
        throw new Error('API key is missing.');
      }
      const result = await action(attempt.config, apiKey);
      return { result, config: attempt.config, account: attempt.account };
    } catch (error) {
      const accountLabel = attempt.account === 'primary' ? 'API 1 (primary)' : 'API 2 (secondary)';
      errors.push(`${accountLabel} (${preset.name}): ${error instanceof Error ? error.message : String(error)}`);
      if (attempt.account === 'primary' && attempts.length > 1) continue;
      if (attempt.account === 'primary' && secondarySkipReason) {
        errors.push(`API 2 (secondary) skipped: ${secondarySkipReason}`);
      }
      throw new Error(errors.join(' | '));
    }
  }
  throw new Error(errors.join(' | ') || 'No configured API provider is available.');
}
