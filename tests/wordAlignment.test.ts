import { describe, expect, it } from 'vitest';
import {
  scoreShadowingOfflineTier3,
  scoreShadowingTier2
} from '../src/services/shadowingScorer';
import {
  alignSpokenWordsToReference,
  computeWordSpeedLabel
} from '../src/services/wordAlignment';

describe('Word Alignment & Tier 3 Offline Shadowing Scorer (5 Required Cases)', () => {
  const reference = 'She has been studying computer science for three years.';

  it('(a) transcript identical to reference -> high score and all words "match"', () => {
    const report = scoreShadowingOfflineTier3({
      referenceText: reference,
      spokenTranscript: 'She has been studying computer science for three years',
      spokenDurationMs: 3300,
      expectedDurationMs: 3300,
      confidence: 0.92
    });

    expect(report.overallScore).toBeGreaterThanOrEqual(90);
    expect(report.pronunciationScore).toBeGreaterThanOrEqual(90);
    expect(report.completenessScore).toBe(100);
    expect(report.fluencyScore).toBeGreaterThanOrEqual(85);
    expect(report.words.every((w) => w.status === 'match')).toBe(true);
    expect(report.weakWords).toHaveLength(0);
  });

  it('(b) 2-3 reference words missing -> those words marked "missing" and score drops clearly', () => {
    // Missing "been", "computer", and "three" (3 words missing out of 9)
    const report = scoreShadowingOfflineTier3({
      referenceText: reference,
      spokenTranscript: 'She has studying science for years',
      spokenDurationMs: 2800,
      expectedDurationMs: 3300,
      confidence: 0.88
    });

    const statusByRef = new Map(
      report.words.filter((w) => w.referenceWord).map((w) => [w.referenceWord, w.status])
    );

    expect(statusByRef.get('been')).toBe('missing');
    expect(statusByRef.get('computer')).toBe('missing');
    expect(statusByRef.get('three')).toBe('missing');
    expect(statusByRef.get('She')).toBe('match');
    expect(statusByRef.get('studying')).toBe('match');

    expect(report.completenessScore).toBe(67); // 6 / 9 words
    expect(report.overallScore).toBeLessThan(70);
    expect(report.weakWords).toEqual(['been', 'computer', 'three']);
  });

  it('(c) different / altered words -> classified as "mispronounced" and "extra"', () => {
    const aligned = alignSpokenWordsToReference(
      'I usually start my morning with coffee.',
      [
        { word: 'I', startMs: 0, endMs: 200, confidence: 0.9 },
        { word: 'always', startMs: 200, endMs: 500, confidence: 0.9 }, // extra/unrelated
        { word: 'usally', startMs: 500, endMs: 850, confidence: 0.7 }, // mispronounced "usually"
        { word: 'start', startMs: 850, endMs: 1150, confidence: 0.9 },
        { word: 'my', startMs: 1150, endMs: 1350, confidence: 0.9 },
        { word: 'mornin', startMs: 1350, endMs: 1700, confidence: 0.68 }, // mispronounced "morning"
        { word: 'with', startMs: 1700, endMs: 1950, confidence: 0.9 },
        { word: 'coffee', startMs: 1950, endMs: 2400, confidence: 0.9 }
      ],
      2400
    );

    const extraWords = aligned.filter((w) => w.status === 'extra').map((w) => w.spokenWord);
    const mispronouncedWords = aligned
      .filter((w) => w.status === 'mispronounced')
      .map((w) => w.referenceWord);

    expect(extraWords).toContain('always');
    expect(mispronouncedWords).toContain('usually');
    expect(mispronouncedWords).toContain('morning');
  });

  it('(d) empty transcript -> returns 0 across all scores and emptyRecognitionError', () => {
    const report = scoreShadowingOfflineTier3({
      referenceText: reference,
      spokenTranscript: '   ',
      spokenDurationMs: 2500,
      expectedDurationMs: 3300,
      confidence: 0
    });

    expect(report.overallScore).toBe(0);
    expect(report.pronunciationScore).toBe(0);
    expect(report.fluencyScore).toBe(0);
    expect(report.completenessScore).toBe(0);
    expect(report.emptyRecognitionError).toContain('Nothing was recognized');
    expect(report.words.every((w) => w.status === 'missing')).toBe(true);
  });

  it('(e) completely unrelated sentence -> very low score (0-15)', () => {
    const report = scoreShadowingOfflineTier3({
      referenceText: reference,
      spokenTranscript: 'purple elephants dance under the bright moon tonight',
      spokenDurationMs: 3300,
      expectedDurationMs: 3300,
      confidence: 0.85
    });

    expect(report.overallScore).toBeLessThanOrEqual(15);
    expect(report.pronunciationScore).toBeLessThanOrEqual(15);
    expect(report.completenessScore).toBeLessThanOrEqual(15);
  });

  describe('Part 2B — Word Timestamps, Speed Labeling & Tier 2 Scoring', () => {
    it('accurately computes word speed labels based on spoken vs expected duration', () => {
      expect(computeWordSpeedLabel(100, 300)).toBe('too fast'); // ratio 0.33 < 0.55
      expect(computeWordSpeedLabel(300, 300)).toBe('OK'); // ratio 1.0
      expect(computeWordSpeedLabel(600, 300)).toBe('too slow'); // ratio 2.0 > 1.65
      expect(computeWordSpeedLabel(undefined, 300)).toBeUndefined();
    });

    it('assigns start/end times and speed labels in aligned word results', () => {
      const aligned = alignSpokenWordsToReference(
        'The quick fox jumps',
        [
          { word: 'The', startMs: 100, endMs: 180, confidence: 0.95 }, // spokenDur: 80 vs expected ~200 -> too fast
          { word: 'quick', startMs: 250, endMs: 650, confidence: 0.95 }, // spokenDur: 400 vs expected ~400 -> OK
          { word: 'fox', startMs: 700, endMs: 1500, confidence: 0.92 }, // spokenDur: 800 vs expected ~300 -> too slow
          { word: 'jumps', startMs: 1550, endMs: 1950, confidence: 0.94 } // spokenDur: 400 vs expected ~400 -> OK
        ],
        1300
      );

      expect(aligned).toHaveLength(4);
      expect(aligned[0]).toMatchObject({
        referenceWord: 'The',
        spokenWord: 'The',
        status: 'match',
        spokenStartMs: 100,
        spokenEndMs: 180,
        speedLabel: 'too fast'
      });
      expect(aligned[1]).toMatchObject({
        referenceWord: 'quick',
        spokenWord: 'quick',
        status: 'match',
        spokenStartMs: 250,
        spokenEndMs: 650,
        speedLabel: 'OK'
      });
      expect(aligned[2]).toMatchObject({
        referenceWord: 'fox',
        spokenWord: 'fox',
        status: 'match',
        spokenStartMs: 700,
        spokenEndMs: 1500,
        speedLabel: 'too slow'
      });
      expect(aligned[3]).toMatchObject({
        referenceWord: 'jumps',
        spokenWord: 'jumps',
        status: 'match',
        speedLabel: 'OK'
      });
    });

    it('scoreShadowingTier2 calculates pace and fluency scores with Whisper word timestamps and labels Tier 2', () => {
      const report = scoreShadowingTier2({
        referenceText: 'The quick brown fox jumps over the lazy dog.',
        spokenTranscript: 'The quick brown fox jumps over the lazy dog',
        spokenTokens: [
          { word: 'The', startMs: 100, endMs: 250, confidence: 0.98 },
          { word: 'quick', startMs: 260, endMs: 550, confidence: 0.97 },
          { word: 'brown', startMs: 560, endMs: 900, confidence: 0.96 },
          { word: 'fox', startMs: 910, endMs: 1250, confidence: 0.95 },
          { word: 'jumps', startMs: 1260, endMs: 1600, confidence: 0.96 },
          { word: 'over', startMs: 1610, endMs: 1900, confidence: 0.98 },
          { word: 'the', startMs: 1910, endMs: 2050, confidence: 0.97 },
          { word: 'lazy', startMs: 2060, endMs: 2400, confidence: 0.96 },
          { word: 'dog', startMs: 2410, endMs: 2800, confidence: 0.95 }
        ],
        spokenDurationMs: 2800,
        expectedDurationMs: 2800
      });

      expect(report.activeTier.tier).toBe(2);
      expect(report.activeTier.label).toBe('Online AI');
      expect(report.activeTier.detailLabel).toContain('Tier 2');
      expect(report.completenessScore).toBe(100);
      expect(report.pronunciationScore).toBeGreaterThanOrEqual(90);
      expect(report.fluencyScore).toBeGreaterThanOrEqual(85);
      expect(report.paceScore).toBeGreaterThanOrEqual(85);
      expect(report.overallScore).toBeGreaterThanOrEqual(85);
      expect(report.overallPaceLabel).toBe('good');
      expect(report.overallPaceRatio).toBeGreaterThanOrEqual(0.9);
      expect(report.words.every((w) => w.speedLabel === 'OK')).toBe(true);
    });

    it('relative speed comparison does not distort words when user speaks slower overall, reporting overall pace separately', () => {
      // User speaks at 1.8x slower overall, but word shares are in natural proportion:
      // Expected durations for "I like reading books" (weights: 2, 4, 7, 5 = 18 total)
      // Reference total = 1800 ms (100ms per weight unit)
      // User total = 3600 ms (200ms per weight unit) -> each word duration doubled
      const aligned = alignSpokenWordsToReference(
        'I like reading books',
        [
          { word: 'I', startMs: 0, endMs: 400, confidence: 0.95 }, // 400ms (11% share)
          { word: 'like', startMs: 400, endMs: 1200, confidence: 0.95 }, // 800ms (22% share)
          { word: 'reading', startMs: 1200, endMs: 2600, confidence: 0.95 }, // 1400ms (39% share)
          { word: 'books', startMs: 2600, endMs: 3600, confidence: 0.95 } // 1000ms (28% share)
        ],
        1800
      );

      // In relative comparison, every word's speed share matches expected share -> all OK!
      expect(aligned.every((w) => w.speedLabel === 'OK')).toBe(true);

      const report = scoreShadowingTier2({
        referenceText: 'I like reading books',
        spokenTranscript: 'I like reading books',
        spokenTokens: [
          { word: 'I', startMs: 0, endMs: 400, confidence: 0.95 },
          { word: 'like', startMs: 400, endMs: 1200, confidence: 0.95 },
          { word: 'reading', startMs: 1200, endMs: 2600, confidence: 0.95 },
          { word: 'books', startMs: 2600, endMs: 3600, confidence: 0.95 }
        ],
        spokenDurationMs: 3600,
        expectedDurationMs: 1800
      });

      // Overall pace is reported separately as 'too slow' (2.0x model duration)
      expect(report.overallPaceRatio).toBe(2.0);
      expect(report.overallPaceLabel).toBe('too slow');
      // While individual words are not distorted
      expect(report.words.every((w) => w.speedLabel === 'OK')).toBe(true);
    });
  });
});
