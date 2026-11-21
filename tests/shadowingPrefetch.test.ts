import { describe, expect, it } from 'vitest';
import { ShadowingPrefetchScheduler, runShadowingPrefetchBatch } from '../src/services/shadowingPrefetch';

describe('Shadowing audio prefetch scheduler', () => {
  it('starts with two future sentences and does not start a second initial batch', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    scheduler.reset(1);

    expect(scheduler.start(20)).toEqual([1, 2]);
    expect(scheduler.start(20)).toEqual([]);
  });

  it('fetches the next two only after two distinct sentences are successfully practised', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    scheduler.reset(1);
    expect(scheduler.start(20)).toEqual([1, 2]);

    expect(scheduler.recordPractice(0, 20)).toEqual([]);
    expect(scheduler.recordPractice(0, 20)).toEqual([]);
    expect(scheduler.recordPractice(1, 20)).toEqual([3, 4]);
    expect(scheduler.recordPractice(1, 20)).toEqual([]);
    expect(scheduler.recordPractice(2, 20)).toEqual([]);
    expect(scheduler.recordPractice(3, 20)).toEqual([5, 6]);
  });

  it('returns only the remaining sentences in the final batch', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    scheduler.reset(17);

    expect(scheduler.start(20)).toEqual([17, 18]);
    expect(scheduler.recordPractice(17, 20)).toEqual([]);
    expect(scheduler.recordPractice(18, 20)).toEqual([19]);
    expect(scheduler.recordPractice(19, 20)).toEqual([]);
  });

  it('resets progress when the active sentence set changes', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    scheduler.reset(1);
    expect(scheduler.start(20)).toEqual([1, 2]);
    expect(scheduler.recordPractice(0, 20)).toEqual([]);

    scheduler.reset(8);
    expect(scheduler.start(20)).toEqual([8, 9]);
    expect(scheduler.recordPractice(8, 20)).toEqual([]);
  });
  it('stops a prefetch batch after the first failed sentence', async () => {
    const attempted: number[] = [];
    const completed = await runShadowingPrefetchBatch([1, 2, 3, 4], async item => {
      attempted.push(item);
      return item !== 2;
    });
    expect(attempted).toEqual([1, 2]);
    expect(completed).toBe(1);
  });

});
