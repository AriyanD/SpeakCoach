import { describe, expect, it } from 'vitest';
import { roundToIeltsBand } from '../src/services/ieltsOfflineEvaluator';

describe('roundToIeltsBand', () => {
  it('rounds to the nearest half band using IELTS boundaries', () => {
    expect(roundToIeltsBand(6.24)).toBe(6);
    expect(roundToIeltsBand(6.25)).toBe(6.5);
    expect(roundToIeltsBand(6.74)).toBe(6.5);
    expect(roundToIeltsBand(6.75)).toBe(7);
  });

  it('keeps whole and half bands unchanged', () => {
    expect(roundToIeltsBand(0)).toBe(0);
    expect(roundToIeltsBand(4.5)).toBe(4.5);
    expect(roundToIeltsBand(9)).toBe(9);
  });

  it('clamps values outside the IELTS band range', () => {
    expect(roundToIeltsBand(-2)).toBe(0);
    expect(roundToIeltsBand(12)).toBe(9);
  });
});
