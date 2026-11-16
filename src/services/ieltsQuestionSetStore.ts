import type { IeltsTestSessionPlan } from '../data/ieltsQuestionTypes';

export interface StoredIeltsQuestionSet {
  id: string;
  title: string;
  plan: IeltsTestSessionPlan;
  status: 'new' | 'completed';
  createdAt: number;
  providerName?: string;
  modelName?: string;
}

const STORAGE_KEY = 'speakcoach_ielts_question_sets_v1';
const PREVIOUS_GENERATIONS_KEY = 'speakcoach_ielts_previous_generations_v1';
const MAX_PREVIOUS_GENERATIONS = 3;
const RECOVERY_PREFIX = 'speakcoach.ielts_question_recovery.v1.';
const recoveryNotices: string[] = [];

export function getIeltsQuestionStoreRecoveryNotices(): string[] {
  return [...recoveryNotices];
}

function preserveQuestionStoreRaw(key: string, raw: string): void {
  const recoveryKey = `${RECOVERY_PREFIX}${key}.${Date.now()}`;
  try {
    localStorage.setItem(recoveryKey, raw);
    recoveryNotices.push(`A damaged question-library copy was preserved as "${recoveryKey}".`);
    console.warn(`[SpeakCoach storage] Preserved unreadable IELTS question data as ${recoveryKey}.`);
  } catch (error) {
    recoveryNotices.push('Some IELTS question-library data could not be parsed or preserved. Avoid refreshing the library until you export a backup.');
    console.error('[SpeakCoach storage] Could not preserve unreadable IELTS question data.', error);
  }
}

type PreviousGeneration = StoredIeltsQuestionSet[];

function getPreviousGenerations(): PreviousGeneration[] {
  const raw = localStorage.getItem(PREVIOUS_GENERATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      preserveQuestionStoreRaw(PREVIOUS_GENERATIONS_KEY, raw);
      return [];
    }
    const valid = parsed.filter(Array.isArray).slice(-MAX_PREVIOUS_GENERATIONS) as PreviousGeneration[];
    if (valid.length !== parsed.length) preserveQuestionStoreRaw(PREVIOUS_GENERATIONS_KEY, raw);
    return valid;
  } catch {
    preserveQuestionStoreRaw(PREVIOUS_GENERATIONS_KEY, raw);
    return [];
  }
}

function savePreviousGenerations(generations: PreviousGeneration[]): void {
  const serialized = JSON.stringify(generations.slice(-MAX_PREVIOUS_GENERATIONS));
  localStorage.setItem(PREVIOUS_GENERATIONS_KEY, serialized);
  if (localStorage.getItem(PREVIOUS_GENERATIONS_KEY) !== serialized) {
    throw new Error('Could not verify the previous question-set history after saving.');
  }
}

export function getPreviousIeltsQuestionSetGenerationCount(): number {
  return getPreviousGenerations().length;
}

/** Restore the immediately previous pending generation; the current pending batch becomes the new undo snapshot. */
export function restorePreviousIeltsQuestionSets(): StoredIeltsQuestionSet[] | null {
  const generations = getPreviousGenerations();
  if (!generations.length) return null;
  const current = getIeltsQuestionSets().filter(set => set.status === 'new');
  const previous = generations.pop()!;
  const completed = getIeltsQuestionSets().filter(set => set.status === 'completed');
  const oldSetsRaw = localStorage.getItem(STORAGE_KEY);
  const oldGenerationsRaw = localStorage.getItem(PREVIOUS_GENERATIONS_KEY);
  try {
    if (current.length) generations.push(current);
    savePreviousGenerations(generations);
    const serializedSets = JSON.stringify([...completed, ...previous]);
    localStorage.setItem(STORAGE_KEY, serializedSets);
    if (localStorage.getItem(STORAGE_KEY) !== serializedSets) throw new Error('Question-set restore verification failed.');
    return previous;
  } catch {
    try {
      if (oldSetsRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, oldSetsRaw);
      if (oldGenerationsRaw === null) localStorage.removeItem(PREVIOUS_GENERATIONS_KEY);
      else localStorage.setItem(PREVIOUS_GENERATIONS_KEY, oldGenerationsRaw);
    } catch { /* preserve best-effort rollback */ }
    return null;
  }
}

export function getIeltsQuestionSets(): StoredIeltsQuestionSet[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      preserveQuestionStoreRaw(STORAGE_KEY, raw);
      return [];
    }
    const valid = parsed.filter((item) =>
      item && typeof item.id === 'string' && item.plan &&
      Array.isArray(item.plan.part1Questions) && item.plan.part2CueCard
    );
    if (valid.length !== parsed.length) preserveQuestionStoreRaw(STORAGE_KEY, raw);
    return valid;
  } catch {
    preserveQuestionStoreRaw(STORAGE_KEY, raw);
    return [];
  }
}

function normalizeQuestion(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function addIeltsQuestionSets(
  incoming: Array<{ plan: IeltsTestSessionPlan; providerName?: string; modelName?: string }>
): StoredIeltsQuestionSet[] {
  const existing = getIeltsQuestionSets();
  const known = new Set(existing.flatMap((set) => [
    ...set.plan.part1Questions.map((q) => normalizeQuestion(q.question)),
    normalizeQuestion(set.plan.part2CueCard.prompt || set.plan.part2CueCard.title),
    ...set.plan.part3Questions.map((q) => normalizeQuestion(q.question))
  ]));
  const added: StoredIeltsQuestionSet[] = [];
  for (const item of incoming) {
    const texts = [
      ...item.plan.part1Questions.map((q) => normalizeQuestion(q.question)),
      normalizeQuestion(item.plan.part2CueCard.prompt || item.plan.part2CueCard.title),
      ...item.plan.part3Questions.map((q) => normalizeQuestion(q.question))
    ];
    const duplicateCount = texts.filter((text) => !text || known.has(text)).length;
    if (duplicateCount >= Math.ceil(texts.length * 0.25)) continue;
    texts.forEach((text) => known.add(text));
    const title = item.plan.part1Questions[0]?.question || item.plan.part2CueCard.title || 'IELTS Speaking Set';
    added.push({
      id: item.plan.id,
      title: title.length > 76 ? title.slice(0, 73).trimEnd() + '…' : title,
      plan: item.plan,
      status: 'new',
      createdAt: Date.now(),
      providerName: item.providerName,
      modelName: item.modelName
    });
  }
  const updated = [...existing, ...added];
  const oldRaw = localStorage.getItem(STORAGE_KEY);
  const serialized = JSON.stringify(updated);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    if (localStorage.getItem(STORAGE_KEY) !== serialized) throw new Error('Question library read-back verification failed.');
  } catch (error) {
    try {
      if (oldRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, oldRaw);
    } catch { /* preserve best-effort rollback */ }
    throw new Error(`Could not save generated IELTS questions. Your previous question sets were kept. ${error instanceof Error ? error.message : String(error)}`);
  }
  return added;
}

/**
 * Replace only pending sets after a complete successful refresh.
 * Completed sets are retained so their saved test results remain reviewable.
 */
export function replaceUncompletedIeltsQuestionSets(
  incoming: Array<{ plan: IeltsTestSessionPlan; providerName?: string; modelName?: string }>
): StoredIeltsQuestionSet[] {
  const completed = getIeltsQuestionSets().filter((set) => set.status === 'completed');
  const known = new Set(completed.flatMap((set) => [
    ...set.plan.part1Questions.map((q) => normalizeQuestion(q.question)),
    normalizeQuestion(set.plan.part2CueCard.prompt || set.plan.part2CueCard.title),
    ...set.plan.part3Questions.map((q) => normalizeQuestion(q.question))
  ]));
  const replacement: StoredIeltsQuestionSet[] = [];
  for (const item of incoming) {
    const texts = [
      ...item.plan.part1Questions.map((q) => normalizeQuestion(q.question)),
      normalizeQuestion(item.plan.part2CueCard.prompt || item.plan.part2CueCard.title),
      ...item.plan.part3Questions.map((q) => normalizeQuestion(q.question))
    ];
    const duplicateCount = texts.filter((value) => !value || known.has(value)).length;
    if (duplicateCount >= Math.ceil(texts.length * 0.25)) continue;
    texts.forEach((value) => known.add(value));
    const title = item.plan.part1Questions[0]?.question || item.plan.part2CueCard.title || 'IELTS Speaking Set';
    replacement.push({
      id: item.plan.id,
      title: title.length > 76 ? title.slice(0, 73).trimEnd() + '…' : title,
      plan: item.plan,
      status: 'new',
      createdAt: Date.now(),
      providerName: item.providerName,
      modelName: item.modelName
    });
  }
  if (replacement.length < incoming.length) {
    throw new Error(`Only ${replacement.length} of ${incoming.length} sets passed duplicate checks. Your current unfinished sets have been kept. Refresh again to request a more varied batch.`);
  }
  const oldSetsRaw = localStorage.getItem(STORAGE_KEY);
  const oldGenerationsRaw = localStorage.getItem(PREVIOUS_GENERATIONS_KEY);
  try {
    const previousGenerations = getPreviousGenerations();
    const currentPending = getIeltsQuestionSets().filter(set => set.status === 'new');
    if (currentPending.length) previousGenerations.push(currentPending);
    savePreviousGenerations(previousGenerations);
    const serializedSets = JSON.stringify([...completed, ...replacement]);
    localStorage.setItem(STORAGE_KEY, serializedSets);
    if (localStorage.getItem(STORAGE_KEY) !== serializedSets) throw new Error('Question-library refresh verification failed.');
  } catch {
    try {
      if (oldSetsRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, oldSetsRaw);
      if (oldGenerationsRaw === null) localStorage.removeItem(PREVIOUS_GENERATIONS_KEY);
      else localStorage.setItem(PREVIOUS_GENERATIONS_KEY, oldGenerationsRaw);
    } catch { /* preserve best-effort rollback */ }
    throw new Error('Could not save the refreshed question library. Your previous sets remain available.');
  }
  return replacement;
}

export function markIeltsQuestionSetCompleted(id: string): void {
  const sets = getIeltsQuestionSets();
  const target = sets.find((set) => set.id === id);
  if (!target) return;
  target.status = 'completed';
  const oldRaw = localStorage.getItem(STORAGE_KEY);
  const serialized = JSON.stringify(sets);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    if (localStorage.getItem(STORAGE_KEY) !== serialized) throw new Error('Question library read-back verification failed.');
  } catch (error) {
    try {
      if (oldRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, oldRaw);
    } catch { /* preserve best-effort rollback */ }
    throw new Error(`Could not mark this question set as completed. Your previous status was kept. ${error instanceof Error ? error.message : String(error)}`);
  }
}


export interface IeltsQuestionSetSnapshot {
  sets: StoredIeltsQuestionSet[];
  previousGenerations: PreviousGeneration[];
}

/** Export generated question sets and the undo history for device-to-device backup. */
export function exportIeltsQuestionSetSnapshot(): IeltsQuestionSetSnapshot {
  return {
    sets: getIeltsQuestionSets(),
    previousGenerations: getPreviousGenerations()
  };
}

function isStoredQuestionSet(value: unknown): value is StoredIeltsQuestionSet {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<StoredIeltsQuestionSet>;
  return typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.createdAt === 'number' &&
    (item.status === 'new' || item.status === 'completed') &&
    Boolean(item.plan) &&
    Array.isArray(item.plan?.part1Questions) &&
    Boolean(item.plan?.part2CueCard) &&
    Array.isArray(item.plan?.part3Questions);
}

/**
 * Restore the generated question library without touching it until the full
 * snapshot has been validated. Both localStorage entries are rolled back if
 * either write fails, so a partially restored undo history is not exposed.
 */
export function importIeltsQuestionSetSnapshot(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('The backup question-library section is invalid.');
  }
  const raw = snapshot as { sets?: unknown; previousGenerations?: unknown };
  if (!Array.isArray(raw.sets) || !raw.sets.every(isStoredQuestionSet)) {
    throw new Error('The backup contains an invalid generated question set. The current question library was not changed.');
  }
  if (raw.previousGenerations !== undefined &&
      (!Array.isArray(raw.previousGenerations) ||
       !raw.previousGenerations.every(generation => Array.isArray(generation) && generation.every(isStoredQuestionSet)))) {
    throw new Error('The backup contains an invalid question-set history. The current question library was not changed.');
  }

  const generations = (raw.previousGenerations ?? []).slice(-MAX_PREVIOUS_GENERATIONS) as PreviousGeneration[];
  const previousSetsRaw = localStorage.getItem(STORAGE_KEY);
  const previousGenerationsRaw = localStorage.getItem(PREVIOUS_GENERATIONS_KEY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw.sets));
    localStorage.setItem(PREVIOUS_GENERATIONS_KEY, JSON.stringify(generations));
    if (localStorage.getItem(STORAGE_KEY) !== JSON.stringify(raw.sets) ||
        localStorage.getItem(PREVIOUS_GENERATIONS_KEY) !== JSON.stringify(generations)) {
      throw new Error('Question-library read-back verification failed.');
    }
  } catch (error) {
    try {
      if (previousSetsRaw === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previousSetsRaw);
      if (previousGenerationsRaw === null) localStorage.removeItem(PREVIOUS_GENERATIONS_KEY);
      else localStorage.setItem(PREVIOUS_GENERATIONS_KEY, previousGenerationsRaw);
    } catch {
      throw new Error('Question-library import failed and automatic rollback was incomplete. Keep the app open and export a diagnostic backup.');
    }
    throw new Error(`Could not restore the generated question library. Your previous sets were kept. ${error instanceof Error ? error.message : String(error)}`);
  }
}
