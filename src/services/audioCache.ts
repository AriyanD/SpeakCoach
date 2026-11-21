import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const AUDIO_CACHE_PREFIX = 'speakcoach.tts.cache.v1.';
const AUDIO_CACHE_INDEX_KEY = `${AUDIO_CACHE_PREFIX}__index__`;
const AUDIO_CACHE_DIRECTORY = 'SpeakCoach/audio-cache';
const MAX_CACHE_ENTRIES = 30;
const MAX_CACHE_ITEM_CHARS = 2_000_000;
const MAX_PERSISTED_CACHE_CHARS = 12_000_000;
const MAX_MEMORY_CACHE_CHARS = 4_000_000;
// Reserve a separate 4M-character RAM budget so ordinary playback entries
// cannot evict the small set of upcoming sentences prepared by Shadowing.
const MAX_PREFETCH_MEMORY_CHARS = 4_000_000;
const memoryAudioCache = new Map<string, string>();
const prefetchedAudioCache = new Map<string, string>();

interface AudioCacheIndexEntry {
  hash: string;
  chars: number;
  lastAccess: number;
}

function cacheFilePath(hash: string): string {
  return `${AUDIO_CACHE_DIRECTORY}/${hash}.txt`;
}

function rememberInMemory(hash: string, value: string): void {
  memoryAudioCache.delete(hash);
  if (value.length > MAX_MEMORY_CACHE_CHARS) return;
  memoryAudioCache.set(hash, value);
  let total = Array.from(memoryAudioCache.values()).reduce((sum, item) => sum + item.length, 0);
  while (total > MAX_MEMORY_CACHE_CHARS && memoryAudioCache.size > 0) {
    const oldestHash = memoryAudioCache.keys().next().value as string | undefined;
    if (!oldestHash) break;
    const oldestValue = memoryAudioCache.get(oldestHash) ?? '';
    memoryAudioCache.delete(oldestHash);
    total -= oldestValue.length;
  }
}

function rememberPrefetchedInMemory(hash: string, value: string): void {
  prefetchedAudioCache.delete(hash);
  if (value.length > MAX_PREFETCH_MEMORY_CHARS) return;
  prefetchedAudioCache.set(hash, value);
  let total = Array.from(prefetchedAudioCache.values()).reduce((sum, item) => sum + item.length, 0);
  while (total > MAX_PREFETCH_MEMORY_CHARS && prefetchedAudioCache.size > 0) {
    const oldestHash = prefetchedAudioCache.keys().next().value as string | undefined;
    if (!oldestHash) break;
    const oldestValue = prefetchedAudioCache.get(oldestHash) ?? '';
    prefetchedAudioCache.delete(oldestHash);
    total -= oldestValue.length;
  }
}

async function readCacheIndex(): Promise<AudioCacheIndexEntry[]> {
  try {
    const stored = await Preferences.get({ key: AUDIO_CACHE_INDEX_KEY });
    if (stored.value) {
      const parsed = JSON.parse(stored.value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is AudioCacheIndexEntry =>
          item && typeof item.hash === 'string' &&
          typeof item.chars === 'number' && typeof item.lastAccess === 'number'
        );
      }
    }
  } catch {
    // Try the browser cache index or reconstruct from legacy cache keys.
  }

  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(AUDIO_CACHE_INDEX_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is AudioCacheIndexEntry =>
            item && typeof item.hash === 'string' &&
            typeof item.chars === 'number' && typeof item.lastAccess === 'number'
          );
        }
      }
    } catch {
      // Reconstruct below.
    }
  }

  const hashes = new Set<string>();
  try {
    const result = await Preferences.keys();
    for (const key of result.keys ?? []) {
      if (key.startsWith(AUDIO_CACHE_PREFIX) && key !== AUDIO_CACHE_INDEX_KEY) {
        hashes.add(key.slice(AUDIO_CACHE_PREFIX.length));
      }
    }
  } catch {
    // Browser fallback below.
  }
  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(AUDIO_CACHE_PREFIX) && key !== AUDIO_CACHE_INDEX_KEY) {
        hashes.add(key.slice(AUDIO_CACHE_PREFIX.length));
      }
    }
  }
  return Array.from(hashes).map(hash => ({ hash, chars: 0, lastAccess: 0 }));
}

async function writeCacheIndex(index: AudioCacheIndexEntry[]): Promise<void> {
  const serialized = JSON.stringify(index);
  try {
    await Preferences.set({ key: AUDIO_CACHE_INDEX_KEY, value: serialized });
  } catch {
    // Browser fallback below.
  }
  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(AUDIO_CACHE_INDEX_KEY, serialized); } catch { /* cache remains optional */ }
  }
}

async function writeNativeAudioFile(hash: string, value: string): Promise<void> {
  await Filesystem.mkdir({
    path: AUDIO_CACHE_DIRECTORY,
    directory: Directory.Cache,
    recursive: true
  });
  await Filesystem.writeFile({
    path: cacheFilePath(hash),
    data: value,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true
  });
}

async function removePersistentAudio(hash: string): Promise<void> {
  const key = `${AUDIO_CACHE_PREFIX}${hash}`;
  if (Capacitor.isNativePlatform()) {
    try {
      await Filesystem.deleteFile({ path: cacheFilePath(hash), directory: Directory.Cache });
    } catch {
      // The file may already have been evicted by Android.
    }
  }
  // Also remove any old Preferences copy left by the previous cache format.
  try { await Preferences.remove({ key }); } catch { /* best-effort legacy cleanup */ }
  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(key); } catch { /* best-effort cache eviction */ }
  }
  memoryAudioCache.delete(hash);
  prefetchedAudioCache.delete(hash);
}

async function touchCacheEntry(hash: string, chars: number): Promise<void> {
  const index = await readCacheIndex();
  const next = index.filter(item => item.hash !== hash);
  next.push({ hash, chars, lastAccess: Date.now() });
  await writeCacheIndex(next);
}

async function prunePersistentAudioCache(index: AudioCacheIndexEntry[]): Promise<void> {
  const sorted = [...index].sort((a, b) => a.lastAccess - b.lastAccess);
  let totalChars = sorted.reduce((sum, item) => sum + item.chars, 0);
  while (sorted.length > MAX_CACHE_ENTRIES || totalChars > MAX_PERSISTED_CACHE_CHARS) {
    const oldest = sorted.shift();
    if (!oldest) break;
    totalChars -= oldest.chars;
    await removePersistentAudio(oldest.hash);
  }
  await writeCacheIndex(sorted);
}

/**
 * Derives a non-reversible cache namespace from the API key. The raw key is
 * never passed into the cache-key hash or persisted in the cache index.
 * Returns null when Web Crypto is unavailable so callers can safely bypass
 * caching rather than share audio across accounts.
 */
export async function createAudioCacheAccountFingerprint(apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
    return Array.from(new Uint8Array(digest).slice(0, 16))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export function computeAudioCacheHash(params: {
  providerId: string;
  voiceOrModel: string;
  rate: number;
  text: string;
  endpoint?: string;
  accountFingerprintHash?: string;
}): string {
  const input = `${params.providerId}|${params.endpoint ?? ''}|${params.accountFingerprintHash ?? ''}|${params.voiceOrModel.trim()}|${params.rate.toFixed(
    2
  )}|${params.text.trim()}`;
  // Deterministic 64-bit FNV-1a twin hash in hex
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

export async function getCachedTtsAudio(hash: string): Promise<string | null> {
  if (prefetchedAudioCache.has(hash)) {
    const value = prefetchedAudioCache.get(hash) ?? '';
    rememberPrefetchedInMemory(hash, value);
    return value || null;
  }
  if (memoryAudioCache.has(hash)) {
    const value = memoryAudioCache.get(hash) ?? '';
    rememberInMemory(hash, value);
    await touchCacheEntry(hash, value.length);
    return value || null;
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const file = await Filesystem.readFile({
        path: cacheFilePath(hash),
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      });
      if (typeof file.data === 'string' && file.data.length > 0) {
        rememberInMemory(hash, file.data);
        await touchCacheEntry(hash, file.data.length);
        return file.data;
      }
    } catch {
      // Check for a legacy Preferences value and migrate it lazily below.
    }
  }

  const key = `${AUDIO_CACHE_PREFIX}${hash}`;
  try {
    const res = await Preferences.get({ key });
    if (res && typeof res.value === 'string' && res.value.length > 0) {
      if (Capacitor.isNativePlatform()) {
        try {
          await writeNativeAudioFile(hash, res.value);
          await Preferences.remove({ key });
        } catch {
          // Preserve and continue serving the old Preferences entry if migration fails.
        }
      }
      rememberInMemory(hash, res.value);
      await touchCacheEntry(hash, res.value.length);
      return res.value;
    }
  } catch {
    // Browser fallback.
  }

  if (!Capacitor.isNativePlatform() && typeof localStorage !== 'undefined') {
    const val = localStorage.getItem(key);
    if (val) {
      rememberInMemory(hash, val);
      await touchCacheEntry(hash, val.length);
      return val;
    }
  }
  return null;
}

export async function setCachedTtsAudio(hash: string, base64OrDataUrl: string): Promise<void> {
  if (!base64OrDataUrl || base64OrDataUrl.length > MAX_CACHE_ITEM_CHARS) return;
  rememberInMemory(hash, base64OrDataUrl);
  const key = `${AUDIO_CACHE_PREFIX}${hash}`;
  let persisted = false;

  if (Capacitor.isNativePlatform()) {
    try {
      await writeNativeAudioFile(hash, base64OrDataUrl);
      persisted = true;
    } catch {
      // Native cache failure must not affect TTS playback; keep memory-only.
    }
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, base64OrDataUrl);
      persisted = true;
    } catch {
      // Storage quota full -> keep the bounded in-memory copy only.
    }
  }
  if (!persisted) return;

  const index = await readCacheIndex();
  const next = index.filter(item => item.hash !== hash);
  next.push({ hash, chars: base64OrDataUrl.length, lastAccess: Date.now() });
  await prunePersistentAudioCache(next);
}

export async function removeTtsAudioCacheEntry(hash: string): Promise<void> {
  await removePersistentAudio(hash);
  const index = await readCacheIndex();
  await writeCacheIndex(index.filter(item => item.hash !== hash));
}

export function clearMemoryAudioCache(): void {
  memoryAudioCache.clear();
  prefetchedAudioCache.clear();
}

/** Keep the fast prefetch RAM layer bounded; active-set persistence is handled by shadowingAudioStore. */
export function setMemoryOnlyTtsAudio(hash: string, dataUrl: string): void {
  if (!dataUrl || dataUrl.length > MAX_CACHE_ITEM_CHARS) return;
  rememberPrefetchedInMemory(hash, dataUrl);
}

export function removeMemoryOnlyTtsAudio(hash: string): void {
  prefetchedAudioCache.delete(hash);
}

/** Remove both RAM layers for a known hash without touching generic disk cache files. */
export function removeTtsAudioFromMemory(hash: string): void {
  memoryAudioCache.delete(hash);
  prefetchedAudioCache.delete(hash);
}
