import { describe, expect, it } from 'vitest';
import { ShadowingPrefetchScheduler, runShadowingPrefetchBatch } from '../src/services/shadowingPrefetch';

describe('Shadowing position-based prefetch scheduler', () => {
  it('queues four sentences after reaching #2, #6 and #10', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    expect(scheduler.reachPosition(0, 20)).toEqual([]);
    const first = scheduler.reachPosition(1, 20);
    expect(first).toEqual([2, 3, 4, 5]);
    expect(scheduler.reachPosition(5, 20)).toEqual([]); // threshold reached while serial batch is still active
    scheduler.completeBatch(4);
    expect(scheduler.reachPosition(5, 20)).toEqual([6, 7, 8, 9]);
    scheduler.completeBatch(4);
    expect(scheduler.reachPosition(9, 20)).toEqual([]); // Repeating #10 does not release another batch.
    scheduler.completeBatch(4);
    expect(scheduler.reachPosition(9, 20)).toEqual([10, 11, 12, 13]);
  });

  it('does not advance the cursor after a failed or deferred batch and retries the remainder', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    expect(scheduler.reachPosition(1, 20)).toEqual([2, 3, 4, 5]);
    scheduler.completeBatch(1);
    expect(scheduler.reachPosition(1, 20)).toEqual([3, 4, 5, 6]);
    scheduler.completeBatch(0);
    expect(scheduler.reachPosition(1, 20)).toEqual([3, 4, 5, 6]);
  });

  it('skips sentences already passed when the learner jumps forward and does not duplicate on backtracking', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    expect(scheduler.reachPosition(7, 20)).toEqual([8, 9, 10, 11]);
    scheduler.completeBatch(4);
    expect(scheduler.reachPosition(2, 20)).toEqual([]);
    expect(scheduler.reachPosition(9, 20)).toEqual([12, 13, 14, 15]);
  });

  it('resets only when the active set changes', () => {
    const scheduler = new ShadowingPrefetchScheduler();
    expect(scheduler.reachPosition(1, 20)).toEqual([2, 3, 4, 5]);
    scheduler.completeBatch(4);
    scheduler.reset(0);
    expect(scheduler.reachPosition(1, 20)).toEqual([2, 3, 4, 5]);
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
