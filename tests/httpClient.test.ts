import { describe, expect, it, vi } from 'vitest';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { nativeHttpRequest, SpeakCoachHttpError, redactUrlForLog } from '../src/services/httpClient';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeTransport =
  (responses: Array<{ status: number; headers?: Record<string, string>; data?: unknown }>) =>
  async (_opts: HttpOptions): Promise<HttpResponse> => {
    const r = responses.shift()!;
    return { status: r.status, headers: r.headers ?? {}, data: r.data ?? {}, url: _opts.url };
  };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('httpClient — retries, Retry-After, jitter, elapsed log', () => {
  it('succeeds on first attempt and returns data', async () => {
    const transport = makeTransport([{ status: 200, data: { ok: true } }]);
    const res = await nativeHttpRequest({ url: 'https://example.com', timeoutMs: 5000 }, transport);
    expect(res.status).toBe(200);
    expect((res.data as { ok: boolean }).ok).toBe(true);
  });

  it('retries on 503 at most maxRetries times and throws SpeakCoachHttpError', async () => {
    // 3 × 503 (1 initial + 2 retries = 3 total attempts, maxRetries=2)
    const transport = makeTransport([
      { status: 503, data: { error: { message: 'overloaded' } } },
      { status: 503, data: { error: { message: 'overloaded' } } },
      { status: 503, data: { error: { message: 'overloaded' } } }
    ]);

    await expect(
      nativeHttpRequest({ url: 'https://example.com', timeoutMs: 5000, maxRetries: 2, retryDelayMs: 10 }, transport)
    ).rejects.toBeInstanceOf(SpeakCoachHttpError);
  });

  it('succeeds after one transient 429 when maxRetries >= 1', async () => {
    const transport = makeTransport([
      { status: 429, data: { error: { message: 'rate limit' } } },
      { status: 200, data: { result: 'ok' } }
    ]);
    const res = await nativeHttpRequest(
      { url: 'https://example.com', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 10 },
      transport
    );
    expect(res.status).toBe(200);
  });

  it('honours Retry-After header (seconds) for the wait window', async () => {
    const calls: number[] = [];
    const transport = async (_opts: HttpOptions): Promise<HttpResponse> => {
      calls.push(Date.now());
      if (calls.length === 1) {
        // respond 429 with Retry-After: 1 second
        return { status: 429, headers: { 'retry-after': '1' }, data: {}, url: _opts.url };
      }
      return { status: 200, headers: {}, data: { ok: true }, url: _opts.url };
    };

    const start = Date.now();
    const res = await nativeHttpRequest(
      { url: 'https://example.com', timeoutMs: 5000, maxRetries: 1 },
      transport
    );
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // Retry-After: 1 → waited ≥ 950 ms (allow some timer slack)
    expect(elapsed).toBeGreaterThanOrEqual(950);
  });

  it('does not retry on 400 (client error — not retryable)', async () => {
    let callCount = 0;
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      callCount++;
      return { status: 400, headers: {}, data: { error: { message: 'bad request' } }, url: opts.url };
    };
    await expect(
      nativeHttpRequest({ url: 'https://example.com', timeoutMs: 5000, maxRetries: 2 }, transport)
    ).rejects.toBeInstanceOf(SpeakCoachHttpError);
    expect(callCount).toBe(1); // no retry for 400
  });

  it('throws SpeakCoachHttpError with isTimeout=true on ETIMEDOUT', async () => {
    const transport = async (_opts: HttpOptions): Promise<HttpResponse> => {
      throw new Error('ETIMEDOUT: connection timeout');
    };
    const err = await nativeHttpRequest(
      { url: 'https://example.com', timeoutMs: 5000, maxRetries: 0 },
      transport
    ).catch((e) => e);
    expect(err).toBeInstanceOf(SpeakCoachHttpError);
    expect((err as SpeakCoachHttpError).isTimeout).toBe(true);
  });

  it('redacts credentials echoed in provider error bodies and network error messages', async () => {
    const echoedKey = 'AIzaSyDUMMY_EXAMPLE_KEY_123456789012345';
    const echoedToken = 'sk-example_private_token_123456789';
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 400,
      headers: {},
      data: { error: { message: `Invalid key=${echoedKey}; Authorization: Bearer ${echoedToken}` } },
      url: opts.url
    });
    let captured: SpeakCoachHttpError | null = null;
    try {
      await nativeHttpRequest({ url: 'https://example.test/v1', timeoutMs: 5000, maxRetries: 0 }, transport);
    } catch (error) {
      captured = error as SpeakCoachHttpError;
    }
    expect(captured).toBeInstanceOf(SpeakCoachHttpError);
    expect(captured?.message).not.toContain(echoedKey);
    expect(captured?.message).not.toContain(echoedToken);
    expect(captured?.responseDetail).not.toContain(echoedKey);
    expect(captured?.responseDetail).not.toContain(echoedToken);
  });

  it('does not retain query-string credentials in HTTP error metadata', async () => {
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => ({
      status: 400,
      headers: {},
      data: { error: { message: 'invalid request' } },
      url: opts.url
    });
    let capturedError: SpeakCoachHttpError | null = null;
    try {
      await nativeHttpRequest({
        url: 'https://example.test/v1/generate?key=private-key',
        timeoutMs: 5000,
        maxRetries: 0
      }, transport);
    } catch (error) {
      capturedError = error as SpeakCoachHttpError;
    }

    expect(capturedError).toBeInstanceOf(SpeakCoachHttpError);
    expect(capturedError?.requestUrl).toBe('https://example.test/v1/generate');
    expect(capturedError?.requestUrl).not.toContain('private-key');
  });

});


describe('HTTP diagnostic URL redaction', () => {
  it('removes Gemini API keys and all query parameters from logged URLs', () => {
    expect(redactUrlForLog('https://generativelanguage.googleapis.com/v1/models/gemini:generateContent?key=super-secret&alt=json'))
      .toBe('https://generativelanguage.googleapis.com/v1/models/gemini:generateContent');
  });

  it('removes URL credentials and fragments', () => {
    expect(redactUrlForLog('https://user:password@example.test/v1/chat?token=secret#private'))
      .toBe('https://example.test/v1/chat');
  });

  it('returns a safe placeholder for malformed URLs', () => {
    expect(redactUrlForLog('not-a-url?key=secret')).toBe('[redacted request URL]');
  });

  it('never logs a query-string API key during retries', async () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const transport = makeTransport([
      { status: 503, data: { error: { message: 'overloaded' } } },
      { status: 200, data: { ok: true } }
    ]);
    await nativeHttpRequest({
      url: 'https://example.test/v1/generate?key=do-not-log-this',
      timeoutMs: 5000,
      maxRetries: 1,
      retryDelayMs: 10
    }, transport);
    expect(spy.mock.calls.flat().join(' ')).not.toContain('do-not-log-this');
    expect(spy.mock.calls.flat().join(' ')).toContain('https://example.test/v1/generate');
    spy.mockRestore();
  });
});


describe('HTTP POST retry safety', () => {
  it('does not automatically replay a POST after a provider 5xx response', async () => {
    let calls = 0;
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      calls++;
      return {
        status: 503,
        headers: {},
        data: { error: { message: 'provider overloaded' } },
        url: opts.url
      };
    };

    await expect(nativeHttpRequest({
      url: 'https://example.test/v1/generate',
      method: 'POST',
      timeoutMs: 5000,
      maxRetries: 2,
      retryDelayMs: 10
    }, transport)).rejects.toBeInstanceOf(SpeakCoachHttpError);
    expect(calls).toBe(1);
  });

  it('may retry a POST after an explicit 429 rate-limit response', async () => {
    let calls = 0;
    const transport = async (opts: HttpOptions): Promise<HttpResponse> => {
      calls++;
      return calls === 1
        ? { status: 429, headers: {}, data: { error: { message: 'rate limited' } }, url: opts.url }
        : { status: 200, headers: {}, data: { ok: true }, url: opts.url };
    };

    const result = await nativeHttpRequest({
      url: 'https://example.test/v1/generate',
      method: 'POST',
      timeoutMs: 5000,
      maxRetries: 1,
      retryDelayMs: 10
    }, transport);
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('does not automatically replay a POST after a network timeout', async () => {
    let calls = 0;
    const transport = async (_opts: HttpOptions): Promise<HttpResponse> => {
      calls++;
      throw new Error('ETIMEDOUT');
    };

    await expect(nativeHttpRequest({
      url: 'https://example.test/v1/generate',
      method: 'POST',
      timeoutMs: 5000,
      maxRetries: 2
    }, transport)).rejects.toBeInstanceOf(SpeakCoachHttpError);
    expect(calls).toBe(1);
  });
});
