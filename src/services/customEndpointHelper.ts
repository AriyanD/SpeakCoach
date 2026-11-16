import { getPreset, normalizeBaseUrl } from '../config/providers';
import type { SlotConfig, SlotId } from '../config/types';

export type WireFormat = 'gemini' | 'openai';

export interface PreparedEndpointRequest {
  url: string;
  headers: Record<string, string>;
}

const CUSTOM_PROVIDER_BY_SLOT: Record<SlotId, string> = {
  voice_tts: 'custom_openai_tts',
  pronunciation_scoring: 'custom_openai_pronunciation',
  ielts_stt: 'custom_openai_stt',
  llm_evaluator: 'custom_openai_eval',
  llm_generator: 'custom_openai_gen'
};

export function getCustomProviderIdForSlot(slotId: SlotId): string {
  return CUSTOM_PROVIDER_BY_SLOT[slotId];
}

/**
 * Resolves the wire format ('gemini' vs 'openai') from SlotConfig:
 * Gemini format ONLY when the host is generativelanguage.googleapis.com
 * or the URL/path contains ':generateContent'; otherwise OpenAI chat format.
 */
export function resolveWireFormat(
  slotConfig: Pick<SlotConfig, 'slotId' | 'providerId' | 'baseUrl'> & Partial<SlotConfig>
): WireFormat {
  const preset = getPreset(slotConfig.slotId, slotConfig.providerId);
  const rawBase = normalizeBaseUrl(slotConfig.baseUrl || preset.defaultBaseUrl);
  const pathOverride = (slotConfig.endpointPathOverride ?? '').trim();
  const combined = `${rawBase}${pathOverride ? `/${pathOverride}` : ''}`;

  if (combined.includes(':generateContent')) {
    return 'gemini';
  }

  try {
    const parsed = new URL(rawBase);
    if (parsed.hostname.toLowerCase() === 'generativelanguage.googleapis.com') {
      return 'gemini';
    }
  } catch {
    if (rawBase.toLowerCase().includes('generativelanguage.googleapis.com')) {
      return 'gemini';
    }
  }

  return 'openai';
}

/**
 * Detects whether the selected provider preset and configured Base URL disagree
 * (e.g. Google Gemini preset with an OpenAI-compatible gateway URL, or OpenAI preset with Google Gemini URL).
 */
export function detectProviderUrlMismatch(
  slotConfig: Pick<SlotConfig, 'slotId' | 'providerId' | 'baseUrl'> & Partial<SlotConfig>
): {
  mismatch: boolean;
  reason?: string;
  suggestedProviderId?: string;
} {
  const preset = getPreset(slotConfig.slotId, slotConfig.providerId);
  if (preset.tier === 3) {
    return { mismatch: false };
  }

  const wireFormat = resolveWireFormat(slotConfig);
  const isGeminiPreset = preset.id.startsWith('gemini_');
  const customProviderId = getCustomProviderIdForSlot(slotConfig.slotId);
  // IELTS STT explicitly supports a manually entered Gemini endpoint even
  // when the user keeps the generic custom-STT provider selected.
  const isManualGeminiSpeechEndpoint =
    (slotConfig.slotId === 'ielts_stt' && slotConfig.providerId === 'custom_openai_stt') ||
    (slotConfig.slotId === 'pronunciation_scoring' && slotConfig.providerId === 'custom_openai_pronunciation');
  if (isManualGeminiSpeechEndpoint && wireFormat === 'gemini') return { mismatch: false };

  if (isGeminiPreset && wireFormat === 'openai') {
    return {
      mismatch: true,
      reason: `Provider "${preset.name}" is selected, but Base URL points to a non-Google endpoint (${slotConfig.baseUrl}). Requests will use OpenAI-compatible format, or you can switch to Custom (OpenAI-compatible).`,
      suggestedProviderId: customProviderId
    };
  }

  if (!isGeminiPreset && wireFormat === 'gemini') {
    return {
      mismatch: true,
      reason: `Provider "${preset.name}" is selected, but Base URL points to Google Gemini (generativelanguage.googleapis.com). Switch to Custom or Google Gemini provider.`,
      suggestedProviderId: customProviderId
    };
  }

  return { mismatch: false };
}

/**
 * Builds a Gemini generateContent request while respecting custom authentication
 * settings. Google's own API accepts x-goog-api-key; custom gateways may use
 * Bearer, a custom header, or a query parameter.
 */
export function buildGeminiEndpointRequest(params: {
  baseUrl: string;
  defaultPath: string;
  apiKey: string;
  slotConfig: SlotConfig;
}): PreparedEndpointRequest {
  const cleanBase = normalizeBaseUrl(params.baseUrl);
  const rawPath = params.slotConfig.endpointPathOverride?.trim() || params.defaultPath;
  let url = rawPath.startsWith('http://') || rawPath.startsWith('https://')
    ? rawPath
    : `${cleanBase}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = params.apiKey.trim();
  if (apiKey) {
    const authStyle = params.slotConfig.authStyle ?? 'bearer';
    if (cleanBase.includes('generativelanguage.googleapis.com')) {
      // Official Gemini endpoints use the API-key header even if an older
      // saved config selected query auth. VPN routing does not change this.
      headers['x-goog-api-key'] = apiKey;
    } else if (authStyle === 'custom_header') {
      headers[params.slotConfig.customHeaderName?.trim() || 'X-API-Key'] = apiKey;
    } else if (authStyle === 'query_param') {
      // Some third-party gateways explicitly require query-string auth.
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${encodeURIComponent(params.slotConfig.customQueryParamName?.trim() || 'key')}=${encodeURIComponent(apiKey)}`;
    } else {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  return { url, headers };
}

/**
 * Redacts API keys from query parameters in a URL and returns the path + redacted query.
 */
export function redactUrlPathForDisplay(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    for (const [k] of u.searchParams.entries()) {
      if (/key|token|secret|auth/i.test(k)) {
        u.searchParams.set(k, '***');
      }
    }
    const search = u.search ? u.search.replace(/%2A/gi, '*') : '';
    return `${u.pathname}${search}`;
  } catch {
    return rawUrl.replace(/([?&](?:key|api_key|access_token|token|secret)=)[^&]+/gi, '$1***');
  }
}

/**
 * Builds request URL and headers honoring:
 * 1. Base URL
 * 2. Standard endpoint vs optional endpointPathOverride
 * 3. AuthStyle: 'bearer' | 'custom_header' | 'query_param'
 */
export function buildCustomEndpointRequest(params: {
  baseUrl: string;
  defaultPath: string;
  apiKey: string;
  slotConfig: SlotConfig;
  defaultHeaders?: Record<string, string>;
}): PreparedEndpointRequest {
  const cleanBase = params.baseUrl.replace(/\/+$/, '');
  const rawPath = params.slotConfig.endpointPathOverride?.trim() || params.defaultPath;

  let url: string;
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) {
    url = rawPath;
  } else {
    const cleanPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    url = `${cleanBase}${cleanPath}`;
  }

  const authStyle = params.slotConfig.authStyle ?? 'bearer';
  const headers: Record<string, string> = { ...(params.defaultHeaders ?? {}) };

  if (params.apiKey) {
    if (authStyle === 'bearer') {
      headers.Authorization = `Bearer ${params.apiKey}`;
    } else if (authStyle === 'custom_header') {
      const headerName = params.slotConfig.customHeaderName?.trim() || 'X-API-Key';
      headers[headerName] = params.apiKey;
    } else if (authStyle === 'query_param') {
      const paramName = params.slotConfig.customQueryParamName?.trim() || 'key';
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${encodeURIComponent(paramName)}=${encodeURIComponent(params.apiKey)}`;
    }
  }

  return { url, headers };
}
