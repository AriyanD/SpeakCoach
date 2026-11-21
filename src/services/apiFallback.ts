import { getPreset } from '../config/providers';
import { CONNECTION_VERIFICATION_TTL_MS, getProviderVerificationInstructions } from './tierManager';
import type { SlotConfig, SlotId, SlotProviderConfig } from '../config/types';
import { loadApiKey } from '../storage/keyStore';
import { createProviderVerificationFingerprint } from './providerHealth';
import { loadAllSlotsConfig, loadSlotConnectionTestResult } from '../storage/localStore';
import { clearProviderAccountHealth, getProviderAccountHealth, markProviderAccountFailure } from './providerHealth';

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
  const primaryKey = primaryPreset.requiresKey ? await loadApiKey(slotId, primaryPreset.id, 'primary') : '';
  const primaryFingerprint = await createProviderVerificationFingerprint(primaryConfig, primaryKey);
  const primaryVerified = !!primaryTest?.ok && primaryTest.providerId === primaryPreset.id &&
    primaryTest.tier === primaryPreset.tier && !!primaryFingerprint &&
    primaryTest.verificationFingerprint === primaryFingerprint &&
    Date.now() - primaryTest.timestamp < CONNECTION_VERIFICATION_TTL_MS &&
    (!primaryPreset.requiresKey || !!primaryKey.trim());
  const primaryHealth = await getProviderAccountHealth(slotId, 'primary');
  if (primaryVerified && !primaryHealth) attempts.push({ config: primaryConfig, account: 'primary' });
  const secondary = allConfigs[slotId].secondary as SlotProviderConfig | undefined;
  let secondarySkipReason = '';
  if (secondary?.verified) {
    const secondaryConfig: SlotConfig = { slotId, ...secondary };
    const secondaryPreset = getPreset(slotId, secondaryConfig.providerId);
    const secondaryKey = secondaryPreset.requiresKey ? await loadApiKey(slotId, secondaryPreset.id, 'secondary') : '';
    const secondaryFingerprint = await createProviderVerificationFingerprint(secondaryConfig, secondaryKey);
    const secondaryTest = secondary.testResult;
    const secondaryVerified = !!secondaryFingerprint &&
      (!secondaryTest?.verificationFingerprint || secondaryTest.verificationFingerprint === secondaryFingerprint) &&
      Date.now() - (secondaryTest?.testedAt ?? 0) < CONNECTION_VERIFICATION_TTL_MS &&
      (!secondaryPreset.requiresKey || !!secondaryKey.trim());
    const secondaryHealth = await getProviderAccountHealth(slotId, 'secondary');
    if (secondaryPreset.tier !== 3 && secondaryVerified && !secondaryHealth) {
      attempts.push({ config: secondaryConfig, account: 'secondary' });
    } else if (!secondaryVerified) {
      secondarySkipReason = 'API 2 verification no longer matches its saved provider configuration or key. Run Test API 2 again.';
    } else if (secondaryHealth) {
      secondarySkipReason = secondaryHealth.state === 'needs-retest'
        ? 'API 2 needs a successful connection re-test.'
        : 'API 2 is cooling down after a temporary provider failure.';
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
  if (primaryHealth) errors.push(primaryHealth.state === 'needs-retest' ? 'API 1 needs a successful connection re-test.' : 'API 1 is cooling down after a temporary provider failure.');
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
      await clearProviderAccountHealth(slotId, attempt.account);
      return { result, config: attempt.config, account: attempt.account };
    } catch (error) {
      await markProviderAccountFailure(slotId, attempt.account, error);
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
