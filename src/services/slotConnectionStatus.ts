import type { ConnectionTestResult, SlotProviderConfig } from '../config/types';

/**
 * A slot is online when either configured account has a successful,
 * non-offline verification. API 2 is an independent valid provider.
 */
export function isOnlineProviderVerified(
  primaryTest?: Pick<ConnectionTestResult, 'ok' | 'tier'>,
  secondary?: Pick<SlotProviderConfig, 'verified' | 'testResult'>
): boolean {
  const primaryReady = primaryTest?.ok === true && primaryTest.tier !== 3;
  const secondaryReady = secondary?.verified === true && secondary.testResult?.ok === true;
  return primaryReady || secondaryReady;
}
