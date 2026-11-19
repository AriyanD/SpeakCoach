import { beforeEach, describe, expect, it } from 'vitest';
import { getPreset } from '../src/config/providers';
import { resolveGlobalTierSummary } from '../src/services/tierManager';
import { saveApiKey } from '../src/storage/keyStore';
import { loadAllSlotsConfig, saveSecondarySlotConfig } from '../src/storage/localStore';
import { renderSettingsView } from '../src/ui/SettingsView';

describe('Settings credential rendering', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not place saved primary or secondary API keys in rendered input values', async () => {
    const configs = await loadAllSlotsConfig();
    const primaryProvider = configs.voice_tts.providerId;
    const secondaryProvider = 'openai_tts';
    const secondaryPreset = getPreset('voice_tts', secondaryProvider);

    configs.voice_tts.secondary = {
      providerId: secondaryProvider,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice
    };

    await saveApiKey('voice_tts', primaryProvider, 'primary-secret-test-key');
    await saveApiKey('voice_tts', secondaryProvider, 'secondary-secret-test-key', 'secondary');
    await saveSecondarySlotConfig('voice_tts', configs.voice_tts.secondary);

    const current = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(current);
    const container = document.createElement('div');
    await renderSettingsView(container, current, summary, async () => {});

    expect(container.querySelector<HTMLInputElement>('#key-voice_tts')?.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('#secondary-key-voice_tts')?.value).toBe('');
    expect(container.innerHTML).not.toContain('primary-secret-test-key');
    expect(container.innerHTML).not.toContain('secondary-secret-test-key');
    expect(container.innerHTML).toContain('stored securely');
    expect(container.querySelector('#quick-setup-toggle')).not.toBeNull();
    expect(container.querySelector('#quick-setup-panel')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('#quick-setup-run-btn')).not.toBeNull();
    expect(container.querySelectorAll('#quick-setup-checklist [data-quick-setup-slot]')).toHaveLength(6);
    expect(container.querySelector('.settings-advanced-settings')).toBeNull();
    expect(container.querySelector('.settings-provider-cards')).not.toBeNull();
    expect(container.querySelector('.settings-provider-cards')?.closest('.settings-intro-card')).not.toBeNull();
    expect(container.querySelector('#required-api-status')).not.toBeNull();
    expect(container.querySelector('.settings-api-required-label')?.textContent).toContain('Required');
  });
  it('preserves an existing Voice/TTS API 2 when Quick Setup has no recommended backup', async () => {
    const secondaryProvider = 'openai_tts';
    const secondaryPreset = getPreset('voice_tts', secondaryProvider);
    const originalSecondary = {
      providerId: secondaryProvider,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice,
      authStyle: 'bearer' as const
    };
    await saveSecondarySlotConfig('voice_tts', originalSecondary);

    const current = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(current);
    const container = document.createElement('div');
    await renderSettingsView(container, current, summary, async () => {});

    container.querySelector<HTMLButtonElement>('#quick-setup-run-btn')!.click();
    const confirm = document.querySelector<HTMLButtonElement>('.sc-dialog-actions .btn-danger');
    expect(confirm).not.toBeNull();
    confirm!.click();

    for (let i = 0; i < 100; i++) {
      if (container.querySelector('#quick-setup-status')?.textContent?.includes('Quick setup finished')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(container.querySelector('#quick-setup-status')?.textContent).toContain('Quick setup finished');
    const after = await loadAllSlotsConfig();
    expect(after.voice_tts.secondary).toEqual(originalSecondary);
  });

});
