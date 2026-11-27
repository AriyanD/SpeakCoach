import type { SlotId } from '../config/types';

export interface SlotRuntimeFailureEntry {
  reason: string;
  at: number;
  status?: number;
  sticky: boolean;
}

export const RUNTIME_FAILURE_TTL_MS = 3 * 60 * 1000; // 3 minutes

const slotRuntimeFailures = new Map<SlotId, SlotRuntimeFailureEntry>();

function isStickyAuthFailure(errOrStatusOrMsg?: unknown): boolean {
  if (typeof errOrStatusOrMsg === 'number') return errOrStatusOrMsg === 401 || errOrStatusOrMsg === 403;
  if (errOrStatusOrMsg && typeof errOrStatusOrMsg === 'object' && 'status' in errOrStatusOrMsg) {
    const status = (errOrStatusOrMsg as { status?: unknown }).status;
    if (status === 401 || status === 403) return true;
  }
  const message = errOrStatusOrMsg instanceof Error
    ? errOrStatusOrMsg.message
    : typeof errOrStatusOrMsg === 'string' ? errOrStatusOrMsg : '';
  return /\bHTTP\s*(401|403)\\b/i.test(message) || /\b(401|403)\\b/.test(message);
}

export function markSlotRuntimeFailure(
  slotId: SlotId,
  reason: string,
  options?: { status?: number; at?: number; sticky?: boolean }
): void {
  const sticky = options?.sticky ?? (isStickyAuthFailure(options?.status) || isStickyAuthFailure(reason));
  if (!sticky) return;
  slotRuntimeFailures.set(slotId, {
    reason,
    at: options?.at ?? Date.now(),
    status: options?.status,
    sticky: true
  });
}

export function getActiveSlotRuntimeFailure(slotId: SlotId, nowMs = Date.now()): SlotRuntimeFailureEntry | null {
  const entry = slotRuntimeFailures.get(slotId);
  if (!entry) return null;
  if (!entry.sticky || nowMs - entry.at >= RUNTIME_FAILURE_TTL_MS) {
    slotRuntimeFailures.delete(slotId);
    return null;
  }
  return entry;
}

export function clearSlotRuntimeFailure(slotId: SlotId): void {
  slotRuntimeFailures.delete(slotId);
}

export function clearAllRuntimeFailures(): void {
  slotRuntimeFailures.clear();
}
