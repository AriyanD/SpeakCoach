/**
 * Position-based sliding-window scheduler for Shadowing.
 * Reaching sentence #2/#6/#10... requests the next four sentences.
 * A failed/deferred batch does not advance the cursor.
 */
export class ShadowingPrefetchScheduler {
  private nextTriggerIndex = 1;
  private nextSentenceIndex = 2;
  private pending: number[] | null = null;

  reset(firstSentenceIndex = 0): void {
    this.nextTriggerIndex = Math.max(1, firstSentenceIndex);
    this.nextSentenceIndex = Math.max(0, firstSentenceIndex + 1);
    this.pending = null;
  }

  reachPosition(sentenceIndex: number, totalSentences: number): number[] {
    if (this.pending || sentenceIndex < this.nextTriggerIndex || totalSentences <= 0) return [];
    // If the learner skipped ahead, do not waste quota on sentences already passed.
    const start = Math.max(this.nextSentenceIndex, sentenceIndex + 1);
    if (start >= totalSentences) return [];
    const end = Math.min(totalSentences, start + 4);
    this.pending = Array.from({ length: end - start }, (_, offset) => start + offset);
    this.nextSentenceIndex = start;
    return [...this.pending];
  }

  completeBatch(completedCount: number): void {
    if (!this.pending) return;
    const completed = Math.max(0, Math.min(this.pending.length, Math.floor(completedCount)));
    this.nextSentenceIndex = this.pending[0] + completed;
    if (completed === this.pending.length) this.nextTriggerIndex += 4;
    this.pending = null;
  }

  get hasPendingBatch(): boolean { return this.pending !== null; }
}

/** Run a serial batch and stop immediately when a prefetch cannot be completed. */
export async function runShadowingPrefetchBatch<T>(
  items: T[],
  prefetch: (item: T) => Promise<boolean>
): Promise<number> {
  let completed = 0;
  for (const item of items) {
    if (!await prefetch(item)) break;
    completed++;
  }
  return completed;
}
