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
  it('keeps API 2 disabled until enabled and clears its draft through the existing Not configured path', async () => {
    const current = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(current);
    const container = document.createElement('div');
    await renderSettingsView(container, current, summary, async () => {});

    const toggle = container.querySelector<HTMLInputElement>('#secondary-api-enabled-voice_tts')!;
    const content = container.querySelector<HTMLElement>('#secondary-api-content-voice_tts')!;
    const provider = container.querySelector<HTMLSelectElement>('#secondary-provider-voice_tts')!;
    const testApi2 = container.querySelector<HTMLButtonElement>('#test-secondary-voice_tts')!;

    expect(toggle.checked).toBe(false);
    expect(content.hidden).toBe(true);
    expect(provider.value).toBe('');
    expect(testApi2.hidden).toBe(true);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(content.hidden).toBe(false);
    expect(provider.value).not.toBe('');
    expect(provider.value).not.toBe(current.voice_tts.providerId);
    expect(testApi2.hidden).toBe(false);

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(content.hidden).toBe(true);
    expect(provider.value).toBe('');
    expect(testApi2.hidden).toBe(true);
    expect(await loadAllSlotsConfig()).toEqual(current);
  });

  it('renders API 2 model discovery controls for every capability, including Voice/TTS', async () => {
    const current = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(current);
    const container = document.createElement('div');
    await renderSettingsView(container, current, summary, async () => {});

    const slotIds = [
      'voice_tts',
      'pronunciation_scoring',
      'ielts_stt',
      'llm_evaluator',
      'llm_generator',
      'llm_translation'
    ] as const;

    for (const slotId of slotIds) {
      expect(container.querySelector(`#fetch-secondary-models-btn-${slotId}`), `${slotId} API 2 Fetch models`).not.toBeNull();
      expect(container.querySelector(`#secondary-models-list-${slotId}`), `${slotId} API 2 model picker`).not.toBeNull();
      expect(container.querySelector(`#fetch-secondary-models-msg-${slotId}`), `${slotId} API 2 model fetch status`).not.toBeNull();
      expect(container.querySelector(`#test-secondary-${slotId}`), `${slotId} API 2 connection test`).not.toBeNull();
      expect(container.querySelector(`#secondary-api-enabled-${slotId}`), `${slotId} API 2 toggle`).not.toBeNull();
      expect(container.querySelector(`#secondary-switch-custom-btn-${slotId}`), `${slotId} API 2 Switch to Custom`).not.toBeNull();
      expect(container.querySelector(`#secondary-mismatch-warning-${slotId}`), `${slotId} API 2 endpoint warning`).not.toBeNull();

      const toggle = container.querySelector<HTMLInputElement>(`#secondary-api-enabled-${slotId}`)!;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      expect(container.querySelector(`#secondary-models-list-${slotId}`)?.children.length, `${slotId} API 2 provider suggestions`).toBeGreaterThan(0);
    }

    expect(container.querySelector('#fetch-voices-btn-voice_tts')).not.toBeNull();
    expect(container.querySelector('#fetch-secondary-voices-btn-voice_tts')).not.toBeNull();
    expect(container.querySelector('#preview-voice-btn-voice_tts')).not.toBeNull();
    expect(container.querySelector('#preview-secondary-voice-btn-voice_tts')).not.toBeNull();
    expect(container.querySelector('.settings-api-divider')).toBeNull();
  });

  it('shows API 2 controls when a saved secondary account exists', async () => {
    const secondaryProvider = 'openai_tts';
    const secondaryPreset = getPreset('voice_tts', secondaryProvider);
    await saveSecondarySlotConfig('voice_tts', {
      providerId: secondaryProvider,
      baseUrl: secondaryPreset.defaultBaseUrl,
      modelOrVoice: secondaryPreset.defaultModelOrVoice
    });
    const current = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(current);
    const container = document.createElement('div');
    await renderSettingsView(container, current, summary, async () => {});
    expect(container.querySelector<HTMLInputElement>('#secondary-api-enabled-voice_tts')?.checked).toBe(true);
    expect(container.querySelector<HTMLElement>('#secondary-api-content-voice_tts')?.hidden).toBe(false);
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
    expect(after.voice_tts.secondary).toMatchObject({
      providerId: originalSecondary.providerId,
      baseUrl: originalSecondary.baseUrl,
      modelOrVoice: originalSecondary.modelOrVoice,
      authStyle: originalSecondary.authStyle
    });
    expect(after.voice_tts.secondary?.verified).toBe(false);
  });

});
