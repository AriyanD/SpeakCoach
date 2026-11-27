import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearIeltsSessionLogs,
  getIeltsSessionLogs,
  logIeltsSessionEvent
} from '../src/services/ieltsTelemetry';

const SESSION_LOG_KEY = 'speakcoach.ielts.session_log.v1';

describe('IELTS diagnostic transcript privacy', () => {
  beforeEach(() => {
    localStorage.clear();
    clearIeltsSessionLogs();
  });

  it('stores recognizer metadata without the recognized answer text', () => {
    const transcript = 'My answer is that public transport should be improved.';
    logIeltsSessionEvent({
      event: 'recognizer_result',
      status: 'transcribing',
      details: `Raw system-recognizer transcript: "${transcript}" | confidence: 0.94 | duration: 18s`
    });

    const logs = getIeltsSessionLogs();
    expect(JSON.stringify(logs)).not.toContain(transcript);
    expect(logs[0]?.details).toContain('characters=');
    expect(logs[0]?.details).toContain('confidence=0.94');
    expect(logs[0]?.details).toContain('duration=18s');
  });

  it('redacts legacy transcripts already stored in technical logs', () => {
    const transcript = 'A previously stored IELTS answer that must not remain in diagnostics.';
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify([
      {
        timestamp: '2026-11-27T12:00:00.000Z',
        event: 'recognizer_result',
        status: 'transcribing',
        details: `Raw system-recognizer transcript: "${transcript}" | confidence: 0.88 | duration: 12s`
      },
      {
        timestamp: '2026-11-27T12:00:01.000Z',
        event: 'whisper_recovered_transcript',
        status: 'transcribing',
        details: `Recovered transcript via Tier 2 STT: "${transcript}"`
      }
    ]));

    const logs = getIeltsSessionLogs();
    expect(JSON.stringify(logs)).not.toContain(transcript);
    expect(localStorage.getItem(SESSION_LOG_KEY)).not.toContain(transcript);
    expect(logs[0]?.details).toContain('characters=');
    expect(logs[1]?.details).toContain('transcript omitted');
  });

  it('omits raw LLM response and error content from new technical events', () => {
    const privateAnswer = 'PRIVATE_IELTS_RESPONSE_SHOULD_NEVER_BE_LOGGED';
    const privateError = 'PRIVATE_PROVIDER_ERROR_BODY_WITH_USER_TEXT';
    logIeltsSessionEvent({
      event: 'LLM Evaluation',
      status: 'error',
      error: privateError,
      details: `Provider: Groq; HTTP 502; Snippet: ${privateAnswer}; raw body: ${privateError}`
    });

    const logs = getIeltsSessionLogs();
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(privateAnswer);
    expect(serialized).not.toContain(privateError);
    expect(logs[0]?.error).toBe('LLM evaluation failed; provider response omitted.');
    expect(logs[0]?.details).toContain('Provider: Groq');
    expect(logs[0]?.details).toContain('HTTP 502');
    expect(localStorage.getItem(SESSION_LOG_KEY)).not.toContain(privateAnswer);
    expect(localStorage.getItem(SESSION_LOG_KEY)).not.toContain(privateError);
  });

  it('redacts legacy LLM evaluation snippets and raw error bodies on read', () => {
    const privateAnswer = 'LEGACY_PRIVATE_IELTS_RESPONSE_SHOULD_NEVER_REMAIN';
    const privateError = 'LEGACY_PRIVATE_PROVIDER_ERROR_BODY';
    localStorage.setItem(SESSION_LOG_KEY, JSON.stringify([
      {
        timestamp: '2026-11-27T12:01:00.000Z',
        event: 'LLM Evaluation',
        status: 'error',
        error: privateError,
        details: `Snippet: ${privateAnswer} | Reason: ${privateError}`
      }
    ]));

    const logs = getIeltsSessionLogs();
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(privateAnswer);
    expect(serialized).not.toContain(privateError);
    expect(logs[0]?.error).toBe('LLM evaluation failed; provider response omitted.');
    expect(logs[0]?.details).toContain('Failure stage: evaluation');
    expect(localStorage.getItem(SESSION_LOG_KEY)).not.toContain(privateAnswer);
    expect(localStorage.getItem(SESSION_LOG_KEY)).not.toContain(privateError);
  });

  it('clears only technical session logs', () => {
    localStorage.setItem('speakcoach.ielts.last_evaluation.v1', '{"answers":[{"transcript":"saved answer"}]}');
    logIeltsSessionEvent({ event: 'test', status: 'idle' });

    clearIeltsSessionLogs();

    expect(getIeltsSessionLogs()).toEqual([]);
    expect(localStorage.getItem('speakcoach.ielts.last_evaluation.v1')).toContain('saved answer');
  });
});
