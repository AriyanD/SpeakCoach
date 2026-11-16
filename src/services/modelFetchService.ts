import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { getPreset, normalizeBaseUrl } from '../config/providers';
import type { SlotConfig } from '../config/types';
import { buildCustomEndpointRequest, buildGeminiEndpointRequest, resolveWireFormat } from './customEndpointHelper';
import { nativeHttpRequest } from './httpClient';

export type TransportFn = (opts: HttpOptions) => Promise<HttpResponse>;

export interface FetchModelsResult {
  supported: boolean;
  models: string[];
  message: string;
}

export async function fetchAvailableModels(
  slotConfig: SlotConfig,
  apiKey: string,
  options?: { transport?: TransportFn }
): Promise<FetchModelsResult> {
  const preset = getPreset(slotConfig.slotId, slotConfig.providerId);

  // Offline tier 3
  if (preset.tier === 3) {
    return {
      supported: false,
      models: [],
      message: `${preset.name} is a built-in offline engine and does not support dynamic model listing.`
    };
  }

  // Azure / ElevenLabs don't support standard /models endpoint in this format
  if (preset.id === 'azure_tts' || preset.id === 'azure_pronunciation') {
    return {
      supported: false,
      models: [],
      message: `${preset.name} uses region voice/language locales, not a GET /models list.`
    };
  }

  if (preset.id === 'elevenlabs_tts') {
    return {
      supported: false,
      models: [],
      message: `${preset.name} uses Voice IDs, not a GET /models endpoint.`
    };
  }

  const baseUrl = normalizeBaseUrl(slotConfig.baseUrl || preset.defaultBaseUrl);
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return {
      supported: false,
      models: [],
      message: 'Base URL must start with http:// or https://.'
    };
  }

  const wireFormat = resolveWireFormat({ ...slotConfig, baseUrl });

  // 1. Google Gemini API (GET /models?key=...)
  if (wireFormat === 'gemini') {
    try {
      const cleanKey = apiKey.trim();
      const prepared = buildGeminiEndpointRequest({
        baseUrl,
        defaultPath: '/models',
        apiKey: cleanKey,
        // Model catalogue requests always use /models, not a generation endpoint override.
        slotConfig: { ...slotConfig, endpointPathOverride: undefined }
      });
      const res = await nativeHttpRequest<{
        models?: Array<{ name?: string; displayName?: string }>;
      }>(
        {
          url: prepared.url,
          method: 'GET',
          headers: prepared.headers,
          timeoutMs: 12000,
          maxRetries: 1
        },
        options?.transport
      );

      const rawList = res.data?.models || [];
      const models = rawList
        .map((m) => {
          const name = m.name || '';
          return name.startsWith('models/') ? name.replace('models/', '') : name;
        })
        .filter((name) => name.length > 0)
        // Gemini's general catalogue also contains text-only models.
        // Never offer those in the dedicated TTS slot.
        .filter((name) => preset.id !== 'gemini_tts' || /(?:^|-)tts(?:-|$)/i.test(name));

      if (models.length === 0) {
        return {
          supported: true,
          models: [],
          message: 'Connected to Gemini models endpoint, but no models were returned.'
        };
      }

      return {
        supported: true,
        models,
        message: preset.id === 'gemini_tts'
          ? `Successfully fetched ${models.length} Gemini TTS model(s).`
          : `Successfully fetched ${models.length} Gemini model(s).`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        supported: false,
        models: [],
        message: `Failed to fetch Gemini models: ${msg}`
      };
    }
  }

  // 2. OpenAI & OpenAI-compatible / Custom OpenAI (GET /models or custom path override)
  try {
    const prepared = buildCustomEndpointRequest({
      baseUrl,
      defaultPath: '/models',
      apiKey: apiKey.trim(),
      slotConfig,
      defaultHeaders: {}
    });

    const res = await nativeHttpRequest<{
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ id?: string; name?: string }>;
    }>(
      {
        url: prepared.url,
        method: 'GET',
        headers: prepared.headers,
        timeoutMs: 12000,
        maxRetries: 1
      },
      options?.transport
    );

    const items = res.data?.data || res.data?.models || [];
    const models = items
      .map((item) => (item.id || item.name || '').trim())
      .filter((id) => id.length > 0);

    if (models.length === 0) {
      return {
        supported: true,
        models: [],
        message: 'Connected to endpoint, but no models list was found in response payload.'
      };
    }

    return {
      supported: true,
      models,
      message: `Successfully fetched ${models.length} model(s).`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      supported: false,
      models: [],
      message: `Provider does not support listing models at ${baseUrl}/models: ${msg}`
    };
  }
}
