import { beforeEach, describe, expect, it } from 'vitest';
import { getPreset } from '../src/config/providers';
import { resolveGlobalTierSummary } from '../src/services/tierManager';
import { saveApiKey } from '../src/storage/keyStore';
import {
  loadAllSlotsConfig,
  saveSlotConfig,
  saveSlotConnectionTestResult
} from '../src/storage/localStore';
import { renderSettingsView } from '../src/ui/SettingsView';

describe('Core API readiness indicator', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stays red until both question generation and IELTS evaluation pass an online connection test', async () => {
    const configs = await loadAllSlotsConfig();

    for (const [slotId, providerId] of [
      ['llm_generator', 'gemini_gen'],
      ['llm_evaluator', 'gemini_eval']
    ] as const) {
      const preset = getPreset(slotId, providerId);
      const config = {
        ...configs[slotId],
        providerId: preset.id,
        baseUrl: preset.defaultBaseUrl,
        modelOrVoice: preset.defaultModelOrVoice
      };
      await saveApiKey(slotId, preset.id, `${slotId}-test-key`);
      await saveSlotConfig(config);
      configs[slotId] = config;
    }

    const render = async () => {
      const summary = await resolveGlobalTierSummary(configs);
      const container = document.createElement('div');
      await renderSettingsView(container, configs, summary, async () => {});
      return container.querySelector<HTMLElement>('#required-api-status');
    };

    // Having both keys is not enough: neither capability has been tested.
    expect((await render())?.classList.contains('missing')).toBe(true);

    await saveSlotConnectionTestResult('llm_generator', {
      ok: true,
      slotId: 'llm_generator',
      providerId: 'gemini_gen',
      tier: 1,
      label: 'Online AI',
      latencyMs: 12,
      message: 'Connection successful'
    });
    expect((await render())?.classList.contains('missing')).toBe(true);

    await saveSlotConnectionTestResult('llm_evaluator', {
      ok: true,
      slotId: 'llm_evaluator',
      providerId: 'gemini_eval',
      tier: 1,
      label: 'Online AI',
      latencyMs: 14,
      message: 'Connection successful'
    });
    const ready = await render();
    expect(ready?.classList.contains('configured')).toBe(true);
    expect(ready?.textContent).toContain('Core APIs configured');
  });
});
