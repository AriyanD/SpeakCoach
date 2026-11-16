import { describe, expect, it } from 'vitest';
import {
  aggregateIeltsSessionMetrics,
  computeAnswerSpeechMetrics
} from '../src/services/ieltsSpeechMetrics';

describe('IELTS Speech Metrics Engine (Stage 3.2)', () => {
  it('computes WPM, lexical diversity, fillers, linkers, and repetitions from transcript', () => {
    const transcript =
      'Well, in my opinion, I I really like living in my hometown because it has great public parks. However, traffic can be, um, sort of bad during rush hour.';

    const metrics = computeAnswerSpeechMetrics({
      transcript,
      durationMs: 12000
    });

    expect(metrics.totalWords).toBeGreaterThan(20);
    expect(metrics.durationSeconds).toBe(12);
    expect(metrics.wordsPerMinute).toBeGreaterThan(100);
    expect(metrics.fillerCount).toBeGreaterThanOrEqual(2); // 'um', 'sort of'
    expect(metrics.linkersCount).toBeGreaterThanOrEqual(2); // 'in my opinion', 'however'
    expect(metrics.repetitionCount).toBeGreaterThanOrEqual(1); // 'I I'
    expect(metrics.lexicalDiversity).toBeGreaterThan(0.6);
  });

  it('measures pauses accurately when word timestamps are present', () => {
    const tokens = [
      { word: 'First', startMs: 0, endMs: 300 },
      { word: 'point', startMs: 350, endMs: 700 },
      // 600ms gap -> pause
      { word: 'is', startMs: 1300, endMs: 1500 },
      // 1200ms gap -> long pause
      { word: 'crucial', startMs: 2700, endMs: 3200 }
    ];

    const metrics = computeAnswerSpeechMetrics({
      transcript: 'First point is crucial',
      durationMs: 3500,
      tokens
    });

    expect(metrics.pauseCount).toBe(2);
    expect(metrics.longPauseCount).toBe(1);
    expect(metrics.totalPauseDurationMs).toBe(1800);
  });

  it('aggregates metrics across multiple test answers into a session summary', () => {
    const m1 = computeAnswerSpeechMetrics({
      transcript: 'I work as a software engineer in a small tech startup.',
      durationMs: 5000
    });
    const m2 = computeAnswerSpeechMetrics({
      transcript: 'Furthermore, I believe artificial intelligence will, you know, change everything.',
      durationMs: 6000
    });

    const summary = aggregateIeltsSessionMetrics([m1, m2]);

    expect(summary.totalAnswers).toBe(2);
    expect(summary.totalWords).toBe(m1.totalWords + m2.totalWords);
    expect(summary.totalDurationSeconds).toBe(11);
    expect(summary.overallWpm).toBeGreaterThan(90);
    expect(summary.totalLinkers).toBeGreaterThanOrEqual(1);
    expect(summary.totalFillers).toBeGreaterThanOrEqual(1);
  });
});
