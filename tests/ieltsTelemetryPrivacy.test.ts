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

  it('clears only technical session logs', () => {
    localStorage.setItem('speakcoach.ielts.last_evaluation.v1', '{"answers":[{"transcript":"saved answer"}]}');
    logIeltsSessionEvent({ event: 'test', status: 'idle' });

    clearIeltsSessionLogs();

    expect(getIeltsSessionLogs()).toEqual([]);
    expect(localStorage.getItem('speakcoach.ielts.last_evaluation.v1')).toContain('saved answer');
  });
});
