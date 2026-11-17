import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapApp } from '../src/main';
import { runFullDiagnostics, runSecureKeyStoreSelfTest } from '../src/services/diagnostics';
import { networkMonitor } from '../src/services/networkMonitor';
import { clearAllRuntimeFailures } from '../src/services/tierManager';
import { saveApiKey } from '../src/storage/keyStore';
import { saveSlotConnectionTestResult } from '../src/storage/localStore';

describe('Diagnostics Service & UI', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllRuntimeFailures();
    networkMonitor.setOnline(true);
  });

  it('passes the secure key storage read/write/clear self-test', async () => {
    const res = await runSecureKeyStoreSelfTest();
    expect(res.ok).toBe(true);
    expect(res.detail).toContain('PASS');
  });

  it('produces a full diagnostics report with active tier per slot and app version', async () => {
    await saveApiKey('voice_tts', 'openai_tts', 'sk-diag-test');
    await saveSlotConnectionTestResult('voice_tts', {
      ok: true, slotId: 'voice_tts', providerId: 'openai_tts', tier: 1,
      label: 'Online AI', latencyMs: 1, message: 'PASS — test fixture'
    });
    const report = await runFullDiagnostics({ appVersion: '0.2.0-stage1' });

    expect(report.appVersion).toBe('0.2.0-stage1');
    expect(report.secureKeyStoreOk).toBe(true);
    expect(report.tierSummary.slots.voice_tts.label).toBe('Online AI');
    expect(report.tierSummary.slots.pronunciation_scoring.label).toBe('Basic offline');
  });

  it('renders the screenshot-ready DiagnosticsView tab', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root, 'diagnostics');

    expect(root.querySelector('#diagnostics-panel')).not.toBeNull();
    expect(root.querySelector('#diag-version-text')?.textContent).toMatch(/v\d+\.\d+\.\d+/);
    expect(root.querySelector('#diag-keystore-detail')?.textContent).toContain('PASS');
    expect(root.querySelectorAll('[data-diag-slot]')).toHaveLength(6);
    expect(root.querySelector('#diag-ielts-logs-card')).not.toBeNull();
  });
});
