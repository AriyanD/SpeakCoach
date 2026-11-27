import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllRuntimeFailures,
  clearSlotRuntimeFailure,
  getActiveSlotRuntimeFailure,
  markSlotRuntimeFailure,
  RUNTIME_FAILURE_TTL_MS
} from '../src/services/runtimeFailureStore';
import { getProviderVerificationInstructions } from '../src/services/tierManager';

describe('runtime failure store', () => {
  beforeEach(() => clearAllRuntimeFailures());

  it('stores only sticky authentication failures and expires them after the TTL', () => {
    const now = 10_000;
    markSlotRuntimeFailure('ielts_stt', 'HTTP 503 unavailable', { at: now });
    expect(getActiveSlotRuntimeFailure('ielts_stt', now + 1)).toBeNull();

    markSlotRuntimeFailure('ielts_stt', 'HTTP 401 unauthorized', { at: now });
    expect(getActiveSlotRuntimeFailure('ielts_stt', now + 1)).toMatchObject({
      reason: 'HTTP 401 unauthorized',
      at: now,
      sticky: true
    });
    expect(getActiveSlotRuntimeFailure('ielts_stt', now + RUNTIME_FAILURE_TTL_MS)).toBeNull();
  });

  it('clears failures per slot without affecting other slots', () => {
    markSlotRuntimeFailure('ielts_stt', 'HTTP 401', { at: 1 });
    markSlotRuntimeFailure('pronunciation_scoring', 'HTTP 403', { at: 1 });
    clearSlotRuntimeFailure('ielts_stt');
    expect(getActiveSlotRuntimeFailure('ielts_stt', 2)).toBeNull();
    expect(getActiveSlotRuntimeFailure('pronunciation_scoring', 2)?.reason).toBe('HTTP 403');
  });
});

describe('slot-specific STT setup guidance', () => {
  it('directs IELTS transcription to the IELTS STT settings', () => {
    const instructions = getProviderVerificationInstructions('ielts_stt');
    expect(instructions).toContain('IELTS');
    expect(instructions).not.toContain('Voice/TTS');
    expect(instructions).toContain('Test API 1');
    expect(instructions).toContain('Test API 2');
  });

  it('directs pronunciation analysis to Shadowing settings', () => {
    const instructions = getProviderVerificationInstructions('pronunciation_scoring');
    expect(instructions).toContain('Shadowing');
    expect(instructions).not.toContain('Voice/TTS');
  });
});
