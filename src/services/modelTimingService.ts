import { Preferences } from '@capacitor/preferences';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import type { SlotConfig } from '../config/types';
import type { ReferenceWordTiming } from '../data/shadowingBank';
import { requestWhisperWordTimestamps } from './whisperSttService';

export interface ModelWordTiming extends ReferenceWordTiming {
  expectedEndMs: number;
  expectedShare: number;
}

const MODEL_TIMING_CACHE_PREFIX = 'speakcoach.model_timing.v1.';
const memoryTimingCache = new Map<string, ModelWordTiming[]>();

export function getModelTimingCacheKey(text: string, voiceOrModel = 'default'): string {
  const clean = `${voiceOrModel.trim()}|${text.trim().toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return `${MODEL_TIMING_CACHE_PREFIX}${(hash >>> 0).toString(16)}`;
}

export async function getCachedModelWordTimings(
  text: string,
  voiceOrModel = 'default'
): Promise<ModelWordTiming[] | null> {
  const key = getModelTimingCacheKey(text, voiceOrModel);
  if (memoryTimingCache.has(key)) {
    return memoryTimingCache.get(key) ?? null;
  }
  try {
    const res = await Preferences.get({ key });
    if (res?.value) {
      const parsed = JSON.parse(res.value) as ModelWordTiming[];
      memoryTimingCache.set(key, parsed);
      return parsed;
    }
  } catch {
    // Ignore in headless environments
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ModelWordTiming[];
        memoryTimingCache.set(key, parsed);
        return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function setCachedModelWordTimings(
  text: string,
  timings: ModelWordTiming[],
  voiceOrModel = 'default'
): Promise<void> {
  const key = getModelTimingCacheKey(text, voiceOrModel);
  memoryTimingCache.set(key, timings);
  const serialized = JSON.stringify(timings);
  try {
    await Preferences.set({ key, value: serialized });
  } catch {
    // Ignore
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, serialized);
    } catch {
      // Storage full
    }
  }
}

export async function deriveModelTimingsFromWhisper(params: {
  text: string;
  audioBase64: string;
  slotConfig: SlotConfig;
  apiKey: string;
  transport?: (opts: HttpOptions) => Promise<HttpResponse>;
}): Promise<ModelWordTiming[]> {
  const cached = await getCachedModelWordTimings(params.text, params.slotConfig.modelOrVoice);
  if (cached && cached.length > 0) {
    return cached;
  }

  const res = await requestWhisperWordTimestamps({
    slotConfig: params.slotConfig,
    apiKey: params.apiKey,
    wavBase64: params.audioBase64,
    transport: params.transport
  });

  if (res.words.length === 0) {
    return [];
  }

  const totalDurMs = res.words.reduce((sum, w) => sum + Math.max(80, w.endMs - w.startMs), 0) || 1;
  const timings: ModelWordTiming[] = res.words.map((w, idx) => {
    const dur = Math.max(80, w.endMs - w.startMs);
    const share = Number((dur / totalDurMs).toFixed(3));
    return {
      index: idx,
      word: w.word,
      normalized: w.word.toLowerCase().replace(/[^a-z0-9]/g, ''),
      expectedStartMs: w.startMs,
      expectedDurationMs: dur,
      expectedEndMs: w.endMs,
      expectedShare: share
    };
  });

  await setCachedModelWordTimings(params.text, timings, params.slotConfig.modelOrVoice);
  return timings;
}

export function clearModelTimingCache(): void {
  memoryTimingCache.clear();
}
