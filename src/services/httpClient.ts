import { CapacitorHttp, type HttpOptions, type HttpResponse } from '@capacitor/core';

export interface HttpRequestConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  data?: unknown;
  dataType?: 'file' | 'formData';
  responseType?: 'text' | 'json' | 'arraybuffer' | 'blob';
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class SpeakCoachHttpError extends Error {
  public readonly status: number;
  public readonly isTimeout: boolean;
  public readonly isNetworkError: boolean;
  public readonly humanMessage: string;
  public readonly requestUrl?: string;
  public readonly responseDetail?: string;
  public readonly retryAfterMs?: number;

  constructor(options: {
    status: number;
    message: string;
    humanMessage: string;
    isTimeout?: boolean;
    isNetworkError?: boolean;
    requestUrl?: string;
    responseDetail?: string;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = 'SpeakCoachHttpError';
    this.status = options.status;
    this.humanMessage = options.humanMessage;
    this.isTimeout = Boolean(options.isTimeout);
    this.isNetworkError = Boolean(options.isNetworkError);
    this.requestUrl = options.requestUrl;
    this.responseDetail = options.responseDetail;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function formatHumanHttpError(status: number, rawDetail?: string, isTimeout = false): string {
  if (isTimeout) {
    return 'The provider did not respond before the timeout. Check your network, gateway URL, and model availability; this does not necessarily mean your internet is disconnected.';
  }
  if (status === 0) {
    return 'Network unreachable. Verify internet access or switch to Basic offline mode.';
  }
  if (status === 401 || status === 403) {
    return `Authentication failed (HTTP ${status}). Check your API key and permissions.`;
  }
  if (status === 404) {
    return 'Endpoint not found (HTTP 404). Verify the Base URL and Model/Voice name.';
  }
  if (status === 429) {
    return 'Rate limit or quota exceeded (HTTP 429). Wait a moment or check your billing quota.';
  }
  if (status >= 500) {
    return `Provider server error (HTTP ${status}). The service may be temporarily overloaded.`;
  }
  const snippet = rawDetail ? `: ${redactSensitiveText(rawDetail).slice(0, 120)}` : '';
  return `HTTP ${status} error${snippet}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:key|api[_-]?key|token|access_token)=)[^&#\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|token|key)["']?\s*[:=]\s*["']?)[^"',&\s}]+/gi, '$1[REDACTED]')
    .replace(/(["']?authorization["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[A-Za-z0-9._~+/-]{20,}/gi, '$1[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/gi, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]');
}

function extractErrorDetail(data: unknown): string {
  if (!data) return '';
  if (typeof data === 'string') return redactSensitiveText(data);
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.message === 'string') return redactSensitiveText(obj.message);
    if (obj.error && typeof obj.error === 'object') {
      const errObj = obj.error as Record<string, unknown>;
      if (typeof errObj.message === 'string') return redactSensitiveText(errObj.message);
    }
    try {
      return redactSensitiveText(JSON.stringify(data));
    } catch {
      return '';
    }
  }
  return '';
}

/** Parse Retry-After header (seconds or HTTP-date), return ms to wait (capped at 30 s). */
function parseRetryAfterMs(headers: Record<string, string>): number | null {
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return null;
  const secs = Number(raw.trim());
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30000);
  const date = Date.parse(raw);
  if (!isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 30000);
  return null;
}

/** Jittered exponential backoff: base * 2^(attempt-1) ± 20% */
function jitteredDelay(baseMs: number, attempt: number): number {
  const exp = baseMs * Math.pow(2, attempt - 1);
  const jitter = exp * 0.2 * (Math.random() * 2 - 1);
  return Math.max(100, Math.round(exp + jitter));
}

/**
 * Request URLs may contain credentials (for example Gemini's ?key= query).
 * Never write query strings, fragments, or user-info to diagnostic logs.
 */
export function redactUrlForLog(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '[redacted request URL]';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function nativeHttpRequest<T = unknown>(
  config: HttpRequestConfig,
  customTransport?: (opts: HttpOptions) => Promise<HttpResponse>
): Promise<{ status: number; data: T; headers: Record<string, string> }> {
  const method = config.method ?? 'GET';
  const timeoutMs = config.timeoutMs ?? 12000;
  // POST requests may create billable AI jobs. Retry them only for an explicit
  // rate-limit response (429); never replay them after a timeout/network error.
  const maxRetries = config.maxRetries ?? (method === 'POST' ? 0 : 1);
  const baseRetryDelayMs = config.retryDelayMs ?? 1000;
  const transport = customTransport ?? ((opts: HttpOptions) => CapacitorHttp.request(opts));

  let attempt = 0;
  const startTime = Date.now();

  while (true) {
    const attemptStart = Date.now();
    try {
      const httpOptions: HttpOptions = {
        url: config.url,
        method,
        headers: config.headers ?? {},
        data: config.data,
        ...(config.dataType ? { dataType: config.dataType } : {}),
        responseType: config.responseType ?? 'json',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      };

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let response: HttpResponse;
      try {
        response = await Promise.race<HttpResponse>([
          transport(httpOptions),
          new Promise<HttpResponse>((_, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error('ETIMEDOUT')), timeoutMs);
          })
        ]);
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      }

      const elapsed = Date.now() - attemptStart;
      const totalElapsed = Date.now() - startTime;

      if (response.status >= 200 && response.status < 300) {
        if (attempt > 0) {
          console.debug(`[httpClient] ${method} ${redactUrlForLog(config.url)} → ${response.status} on attempt ${attempt + 1} (${elapsed} ms, total ${totalElapsed} ms)`);
        }
        return {
          status: response.status,
          data: response.data as T,
          headers: response.headers ?? {}
        };
      }

      const retryableForMethod = method !== 'POST' || response.status === 429;
      if (attempt < maxRetries && retryableForMethod && isRetryableStatus(response.status)) {
        const retryAfterMs = parseRetryAfterMs(response.headers ?? {});
        const waitMs = retryAfterMs ?? jitteredDelay(baseRetryDelayMs, attempt + 1);
        console.debug(`[httpClient] ${method} ${redactUrlForLog(config.url)} → ${response.status} attempt ${attempt + 1}/${maxRetries + 1} (${elapsed} ms); retry in ${waitMs} ms`);
        attempt++;
        await delay(waitMs);
        continue;
      }

      const detail = extractErrorDetail(response.data);
      throw new SpeakCoachHttpError({
        status: response.status,
        message: `HTTP ${response.status} ${detail}`.trim(),
        humanMessage: formatHumanHttpError(response.status, detail, false),
        requestUrl: redactUrlForLog(config.url),
        responseDetail: detail,
        retryAfterMs: parseRetryAfterMs(response.headers ?? {}) ?? undefined
      });
    } catch (err) {
      if (err instanceof SpeakCoachHttpError) {
        throw err;
      }
      const rawMsg = redactSensitiveText(err instanceof Error ? err.message : String(err));
      const isTimeout = rawMsg.includes('ETIMEDOUT') || rawMsg.toLowerCase().includes('timeout');
      const elapsed = Date.now() - attemptStart;

      if (attempt < maxRetries && method !== 'POST') {
        const waitMs = jitteredDelay(baseRetryDelayMs, attempt + 1);
        console.debug(`[httpClient] ${method} ${redactUrlForLog(config.url)} → ${isTimeout ? 'TIMEOUT' : 'ERROR'} attempt ${attempt + 1}/${maxRetries + 1} (${elapsed} ms); retry in ${waitMs} ms`);
        attempt++;
        await delay(waitMs);
        continue;
      }

      throw new SpeakCoachHttpError({
        status: 0,
        message: rawMsg,
        humanMessage: formatHumanHttpError(0, rawMsg, isTimeout),
        isTimeout,
        isNetworkError: !isTimeout,
        requestUrl: redactUrlForLog(config.url)
      });
    }
  }
}
