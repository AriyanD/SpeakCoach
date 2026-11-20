/**
 * Plans low-pressure Shadowing audio prefetch.
 * The current sentence is requested on demand; this scheduler only handles
 * upcoming sentences and advances in four-item batches after two distinct
 * sentences have been successfully practised.
 */
export class ShadowingPrefetchScheduler {
  private nextSentenceIndex = 0;
  private started = false;
  private readonly practisedSentenceIndices = new Set<number>();
  private nextPracticeMilestone = 2;

  reset(firstSentenceIndex = 0): void {
    this.nextSentenceIndex = Math.max(0, firstSentenceIndex);
    this.started = false;
    this.practisedSentenceIndices.clear();
    this.nextPracticeMilestone = 2;
  }

  start(totalSentences: number): number[] {
    if (this.started) return [];
    this.started = true;
    return this.takeBatch(totalSentences);
  }

  recordPractice(sentenceIndex: number, totalSentences: number): number[] {
    if (!this.started || sentenceIndex < 0 || sentenceIndex >= totalSentences) return [];
    this.practisedSentenceIndices.add(sentenceIndex);
    if (this.practisedSentenceIndices.size < this.nextPracticeMilestone) return [];

    this.nextPracticeMilestone += 2;
    return this.takeBatch(totalSentences);
  }

  private takeBatch(totalSentences: number): number[] {
    const end = Math.min(totalSentences, this.nextSentenceIndex + 4);
    const indices = Array.from(
      { length: Math.max(0, end - this.nextSentenceIndex) },
      (_, offset) => this.nextSentenceIndex + offset
    );
    this.nextSentenceIndex = end;
    return indices;
  }
}
