import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapApp } from '../src/main';
import { fetchAvailableModels } from '../src/services/modelFetchService';
import { saveApiKey } from '../src/storage/keyStore';
import { saveSlotConfig } from '../src/storage/localStore';

describe('Editable Combobox, Fetch Models & Copy Key across Slots (Task F5b)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fetches OpenAI-compatible models from GET {baseUrl}/models and returns model list', async () => {
    let capturedUrl = '';
    let capturedAuth = '';

    const res = await fetchAvailableModels(
      {
        slotId: 'llm_evaluator',
        providerId: 'openai_compat_eval',
        baseUrl: 'https://api.openai.com/v1',
        modelOrVoice: 'gpt-4o-mini'
      },
      'sk-test-key',
      {
        transport: async (opts) => {
          capturedUrl = opts.url;
          capturedAuth = (opts.headers?.Authorization as string) || '';
          return {
            status: 200,
            headers: {},
            data: {
              data: [
                { id: 'gpt-4o-mini' },
                { id: 'gpt-4o' },
                { id: 'gpt-3.5-turbo' }
              ]
            },
            url: opts.url
          };
        }
      }
    );

    expect(res.supported).toBe(true);
    expect(capturedUrl).toBe('https://api.openai.com/v1/models');
    expect(capturedAuth).toBe('Bearer sk-test-key');
    expect(res.models).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo']);
    expect(res.message).toContain('Successfully fetched 3 model(s)');
  });

  it('fetches Google Gemini models using the API-key header and strips "models/" prefix', async () => {
    let capturedUrl = '';
    let capturedApiKey = '';

    const res = await fetchAvailableModels(
      {
        slotId: 'llm_evaluator',
        providerId: 'gemini_eval',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-1.5-flash'
      },
      'gemini-api-key',
      {
        transport: async (opts) => {
          capturedUrl = opts.url;
          capturedApiKey = (opts.headers?.['x-goog-api-key'] as string) || '';
          return {
            status: 200,
            headers: {},
            data: {
              models: [
                { name: 'models/gemini-1.5-flash' },
                { name: 'models/gemini-1.5-pro' },
                { name: 'models/gemini-2.0-flash' }
              ]
            },
            url: opts.url
          };
        }
      }
    );

    expect(res.supported).toBe(true);
    expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(capturedUrl).not.toContain('key=');
    expect(capturedApiKey).toBe('gemini-api-key');
    expect(res.models).toEqual(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash']);
  });

  it('filters the Gemini model catalogue to TTS-capable models in the Voice slot', async () => {
    const res = await fetchAvailableModels(
      {
        slotId: 'voice_tts',
        providerId: 'gemini_tts',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        modelOrVoice: 'gemini-3.8-flash-lite-tts'
      },
      'gemini-api-key',
      {
        transport: async (opts) => ({
          status: 200, headers: {}, url: opts.url,
          data: { models: [
            { name: 'models/gemini-3.8-flash-lite-tts' },
            { name: 'models/gemini-3.8-flash-tts' },
            { name: 'models/gemini-3.5-flash-lite' },
            { name: 'models/gemini-3.1-flash-tts-preview' }
          ] }
        })
      }
    );
    expect(res.models).toEqual([
      'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview'
    ]);
    expect(res.message).toContain('Gemini TTS model(s)');
  });

  it('reports a clear message when a provider does not support model listing (e.g. offline engine or error)', async () => {
    // 1. Built-in offline tier 3
    const offlineRes = await fetchAvailableModels(
      {
        slotId: 'llm_evaluator',
        providerId: 'offline_rule_eval',
        baseUrl: 'offline://rule-evaluator',
        modelOrVoice: 'heuristic-v1'
      },
      ''
    );
    expect(offlineRes.supported).toBe(false);
    expect(offlineRes.message).toContain('built-in offline engine and does not support dynamic model listing');

    // 2. HTTP 404 or unsupported endpoint
    const errorRes = await fetchAvailableModels(
      {
        slotId: 'llm_generator',
        providerId: 'custom_openai_gen',
        baseUrl: 'https://gateway.unsupported.org/v1',
        modelOrVoice: 'custom-model'
      },
      'test-key',
      {
        transport: async (opts) => ({
          status: 404,
          headers: {},
          data: { error: { message: 'Not found' } },
          url: opts.url
        })
      }
    );
    expect(errorRes.supported).toBe(false);
    expect(errorRes.message).toContain('Provider does not support listing models');
  });

  it('renders compact model menu and copy-key button across slots in SettingsView', async () => {
    // Save an API key on slot 1 (voice_tts)
    await saveApiKey('voice_tts', 'openai_tts', 'sk-reusable-openai-key');
    await saveSlotConfig({
      slotId: 'voice_tts',
      providerId: 'openai_tts',
      baseUrl: 'https://api.openai.com/v1',
      modelOrVoice: 'tts-1:alloy'
    });

    const root = document.createElement('div');
    await bootstrapApp(root, 'settings');

    // Provider selection uses an anchored compact menu, not the Android full-screen native picker.
    const providerSelect = root.querySelector<HTMLSelectElement>('#provider-llm_evaluator');
    const providerPicker = root.querySelector<HTMLElement>('#provider-picker-llm_evaluator');
    const providerTrigger = root.querySelector<HTMLButtonElement>('#provider-trigger-llm_evaluator');
    const providerOptions = root.querySelector<HTMLElement>('#provider-options-llm_evaluator');
    expect(providerSelect).not.toBeNull();
    expect(providerPicker).not.toBeNull();
    expect(providerTrigger).not.toBeNull();
    expect(providerOptions?.hidden).toBe(true);
    providerTrigger?.click();
    expect(providerOptions?.hidden).toBe(false);
    providerOptions?.querySelector<HTMLButtonElement>('[data-provider-id]')?.click();
    expect(providerOptions?.hidden).toBe(true);

    // Default endpoint is populated and visibly identified before the user edits it.
    const baseUrl = root.querySelector<HTMLInputElement>('#baseurl-llm_evaluator');
    const baseUrlLabel = root.querySelector<HTMLLabelElement>('label[for="baseurl-llm_evaluator"]');
    expect(baseUrl?.value).not.toBe('');
    expect(baseUrlLabel?.textContent?.trim()).toBe('Base URL');
    expect(baseUrlLabel?.parentElement?.contains(baseUrl)).toBe(true);
    expect(baseUrl?.closest('.settings-baseurl-field')).not.toBeNull();

    // Secondary provider uses the same anchored dropdown instead of a native full-screen picker.
    const secondarySelect = root.querySelector<HTMLSelectElement>('#secondary-provider-llm_evaluator');
    const secondaryTrigger = root.querySelector<HTMLButtonElement>('#secondary-provider-trigger-llm_evaluator');
    const secondaryOptions = root.querySelector<HTMLElement>('#secondary-provider-options-llm_evaluator');
    expect(secondarySelect).not.toBeNull();
    expect(secondaryTrigger).not.toBeNull();
    expect(secondaryOptions?.hidden).toBe(true);
    secondaryTrigger?.click();
    expect(secondaryOptions?.hidden).toBe(false);
    secondaryOptions?.querySelector<HTMLButtonElement>('[data-secondary-provider-id]:not([data-secondary-provider-id=""])')?.click();
    expect(secondaryOptions?.hidden).toBe(true);
    expect(secondarySelect?.value).not.toBe('');
    expect(root.querySelector<HTMLInputElement>('#secondary-baseurl-llm_evaluator')?.value).not.toBe('');
    expect(root.querySelector('#save-status-llm_evaluator')).not.toBeNull();

    // Check the compact custom model menu on llm_evaluator.
    const modelInput = root.querySelector<HTMLInputElement>('#model-llm_evaluator');
    const modelOptions = root.querySelector<HTMLElement>('#models-list-llm_evaluator');
    const modelMenu = modelOptions?.closest<HTMLElement>('.model-picker-dropdown');
    expect(modelInput).not.toBeNull();
    expect(modelInput?.getAttribute('list')).toBeNull();
    expect(modelMenu).not.toBeNull();
    const modelTrigger = modelMenu?.querySelector<HTMLButtonElement>('.model-picker-trigger');
    expect(modelTrigger?.textContent).toContain('Browse available models');
    expect(modelOptions?.querySelectorAll('.model-option').length).toBeGreaterThan(0);

    const settingsCard = modelMenu?.closest<HTMLDetailsElement>('.settings-accordion');
    if (settingsCard) settingsCard.open = true;
    modelTrigger?.click();
    expect(modelOptions?.hidden).toBe(false);
    const firstModel = modelOptions?.querySelector<HTMLButtonElement>('.model-option');
    const firstModelName = firstModel?.dataset.modelValue;
    firstModel?.click();
    expect(modelInput?.value).toBe(firstModelName);
    expect(modelOptions?.hidden).toBe(true);
    expect(settingsCard?.open).toBe(true);

    // Re-open the model list and verify tapping elsewhere dismisses it.
    modelTrigger?.click();
    expect(modelOptions?.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(modelOptions?.hidden).toBe(true);

    // Check "Fetch models" button exists
    const fetchBtn = root.querySelector<HTMLButtonElement>('#fetch-models-btn-llm_evaluator');
    expect(fetchBtn).not.toBeNull();
    expect(fetchBtn?.textContent).toContain('Fetch models');

    // Check "Copy key" button exists on llm_evaluator (because voice_tts has a key saved)
    const copyKeyBtn = root.querySelector<HTMLButtonElement>('#copy-key-btn-llm_evaluator');
    const copyKeySelect = root.querySelector<HTMLSelectElement>('#copy-key-source-llm_evaluator');
    const keyInput = root.querySelector<HTMLInputElement>('#key-llm_evaluator');

    expect(copyKeyBtn).not.toBeNull();
    expect(copyKeySelect?.innerHTML).toContain('voice_tts');
    const copyKeyTrigger = root.querySelector<HTMLButtonElement>('#copy-key-trigger-llm_evaluator');
    const copyKeyOptions = root.querySelector<HTMLElement>('#copy-key-options-llm_evaluator');
    expect(copyKeyTrigger).not.toBeNull();
    expect(copyKeyOptions?.hidden).toBe(true);
    copyKeyTrigger?.click();
    expect(copyKeyOptions?.hidden).toBe(false);
    copyKeyOptions?.querySelector<HTMLButtonElement>('[data-copy-key-source="voice_tts|primary"]')?.click();
    expect(copyKeyOptions?.hidden).toBe(true);
    expect(copyKeySelect?.value).toBe('voice_tts|primary');

    // Click "Copy key" and verify key input is populated
    copyKeyBtn?.click();
    expect(keyInput?.value).toBe('sk-reusable-openai-key');
  });
});
