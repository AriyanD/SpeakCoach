import { beforeEach, describe, expect, it } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { clearIeltsTelemetry, getLastIeltsEvaluation } from '../src/services/ieltsTelemetry';
import { clearLastShadowingAttempt, getLastShadowingAttempt } from '../src/services/shadowingTelemetry';

describe('telemetry clearing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes the IELTS last-evaluation record from Preferences and browser fallback', async () => {
    const key = 'speakcoach.ielts.last_evaluation.v1';
    const record = JSON.stringify({ mode: 'full', timestamp: '2026-11-20T00:00:00.000Z', answers: [] });
    await Preferences.set({ key, value: record });
    localStorage.setItem(key, record);

    expect(await getLastIeltsEvaluation()).not.toBeNull();
    await clearIeltsTelemetry();

    expect((await Preferences.get({ key })).value).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    await expect(getLastIeltsEvaluation()).resolves.toBeNull();
  });

  it('removes the last Shadowing attempt from Preferences and browser fallback', async () => {
    const key = 'speakcoach.shadowing.last_attempt.v1';
    const record = JSON.stringify({ timestamp: '2026-11-20T00:00:00.000Z', referenceText: 'Test sentence' });
    await Preferences.set({ key, value: record });
    localStorage.setItem(key, record);

    expect(await getLastShadowingAttempt()).not.toBeNull();
    await clearLastShadowingAttempt();

    expect((await Preferences.get({ key })).value).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    await expect(getLastShadowingAttempt()).resolves.toBeNull();
  });
});
