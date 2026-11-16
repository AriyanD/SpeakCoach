import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAllSlotsConfig } from '../src/config/providers';
import {
  getStorageRecoveryNotices,
  loadAllConnectionTestResults,
  loadAllSlotsConfig
} from '../src/storage/localStore';

describe('storage corruption recovery', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves malformed provider settings before using defaults', async () => {
    localStorage.setItem('speakcoach.slots.config.v1', '{broken settings');
    await expect(loadAllSlotsConfig()).resolves.toEqual(createDefaultAllSlotsConfig());
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('speakcoach.storage_recovery.v1.speakcoach.slots.config.v1.'));
    expect(recoveryKey).toBeTruthy();
    expect(localStorage.getItem(recoveryKey!)).toBe('{broken settings');
    expect(getStorageRecoveryNotices().some(message => message.includes('speakcoach.slots.config.v1'))).toBe(true);
  });

  it('preserves malformed provider connection results instead of silently discarding them', async () => {
    localStorage.setItem('speakcoach.slots.connection_tests.v1', '{broken connection data');
    await expect(loadAllConnectionTestResults()).resolves.toEqual({});
    const recoveryKey = Object.keys(localStorage).find(key => key.startsWith('speakcoach.storage_recovery.v1.speakcoach.slots.connection_tests.v1.'));
    expect(recoveryKey).toBeTruthy();
    expect(localStorage.getItem(recoveryKey!)).toBe('{broken connection data');
  });
});
