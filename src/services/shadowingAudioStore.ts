import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { removeTtsAudioCacheEntries, removeTtsAudioFromMemory } from './audioCache';

const INDEX_KEY = 'speakcoach.shadowing.audio-set-index.v2';
const LEGACY_INDEX_KEY = 'speakcoach.shadowing.audio-set-index.v1';
export const MAX_RETAINED_AUDIO_SETS = 3;
const ACTIVE_SET_KEY = 'speakcoach.shadowing.audio-active-set.v1';
const ROOT = 'SpeakCoach/shadowing-audio';
const MAX_SET_CHARS = 40_000_000;
const MAX_ACTIVE_SET_RAM_CHARS = 4_000_000;

interface Entry {
  hash: string;
  file: string;
  size: number;
  createdAt: number;
  kind: 'sentence' | 'extra';
}
interface SetEntries { createdAt: number; lastUsedAt: number; entries: Entry[]; }
interface Index { version: 2; activeSetId: string | null; sets: Record<string, SetEntries>; }

let activeSetId: string | null = null;
let generation = 0;
let index: Index | null = null;
let initialization: Promise<void> | null = null;
let activationQueue: Promise<void> = Promise.resolve();
const ram = new Map<string, string>();
const playing = new Map<string, number>();
const deferredSetDeletes = new Map<string, Entry[]>();

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}
function filePath(setId: string, hash: string): string {
  return `${ROOT}/${safeId(setId)}/${hash}.txt`;
}
function ramKey(setId: string, hash: string): string { return `${setId}:${hash}`; }
function rememberSetRam(setId: string, hash: string, value: string): void {
  const key = ramKey(setId, hash);
  ram.delete(key);
  if (value.length > MAX_ACTIVE_SET_RAM_CHARS) return;
  ram.set(key, value);
  let total = Array.from(ram.values()).reduce((sum, item) => sum + item.length, 0);
  while (total > MAX_ACTIVE_SET_RAM_CHARS && ram.size > 0) {
    const oldestKey = ram.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldestValue = ram.get(oldestKey) ?? '';
    ram.delete(oldestKey);
    total -= oldestValue.length;
  }
}

async function readIndex(): Promise<Index | null> {
  try {
    const raw = (await Preferences.get({ key: INDEX_KEY })).value;
    if (raw) {
      const parsed = JSON.parse(raw) as Index;
      if (parsed.version === 2 && parsed.sets && typeof parsed.sets === 'object') return parsed;
    }
    const legacyRaw = (await Preferences.get({ key: LEGACY_INDEX_KEY })).value;
    if (!legacyRaw) return null;
    const legacy = JSON.parse(legacyRaw) as { setId?: string; entries?: Entry[] };
    if (typeof legacy.setId !== 'string' || !Array.isArray(legacy.entries)) return null;
    const now = Date.now();
    return { version: 2, activeSetId: legacy.setId, sets: {
      [legacy.setId]: { createdAt: now, lastUsedAt: now, entries: legacy.entries.filter(e =>
        e && typeof e.hash === 'string' && typeof e.file === 'string' &&
        typeof e.size === 'number' && (e.kind === 'sentence' || e.kind === 'extra')
      ) }
    } };
  } catch { return null; }
}
async function writeIndex(): Promise<void> {
  if (index) await Preferences.set({ key: INDEX_KEY, value: JSON.stringify(index) });
}

export function selectActiveSetAudioEvictions(
  entries: Array<Pick<Entry, 'hash' | 'size' | 'createdAt' | 'kind'>>,
  incomingSize: number,
  maxChars = MAX_SET_CHARS
): string[] {
  let total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const evictions: string[] = [];
  for (const extra of entries.filter(entry => entry.kind === 'extra').sort((a, b) => a.createdAt - b.createdAt)) {
    if (total + incomingSize <= maxChars) break;
    evictions.push(extra.hash);
    total -= extra.size;
  }
  return evictions;
}

async function removeFile(path: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch { /* already absent */ }
  } else {
    try { localStorage.removeItem(`speakcoach.shadowing.audio.${path}`); } catch { /* best effort */ }
  }
}
async function readFile(path: string): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof result.data === 'string' ? result.data : null;
    } catch { return null; }
  }
  try { return localStorage.getItem(`speakcoach.shadowing.audio.${path}`); } catch { return null; }
}
async function writeFile(path: string, data: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const folder = path.slice(0, path.lastIndexOf('/'));
    await Filesystem.mkdir({ path: folder, directory: Directory.Data, recursive: true });
    await Filesystem.writeFile({ path, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  } else {
    localStorage.setItem(`speakcoach.shadowing.audio.${path}`, data);
  }
}
function deferSetFiles(setId: string, entries: Entry[]): void {
  const combined = [...(deferredSetDeletes.get(setId) ?? []), ...entries];
  const unique = new Map(combined.map(entry => [entry.file, entry]));
  deferredSetDeletes.set(setId, [...unique.values()]);
}
function hasPlayingAudio(setId: string): boolean {
  for (const [key, count] of playing) if (count > 0 && key.startsWith(`${setId}:`)) return true;
  return false;
}
export function markActiveSetAudioPlaying(setId: string, hash: string): void {
  const key = ramKey(setId, hash);
  playing.set(key, (playing.get(key) ?? 0) + 1);
}
export async function releaseActiveSetAudioPlaying(setId: string, hash: string): Promise<void> {
  const key = ramKey(setId, hash);
  const count = playing.get(key) ?? 0;
  if (count <= 1) playing.delete(key); else playing.set(key, count - 1);
  if (!hasPlayingAudio(setId)) {
    const pending = deferredSetDeletes.get(setId);
    if (pending) {
      deferredSetDeletes.delete(setId);
      await removeSetFiles(setId, pending, true);
    }
  }
}

async function removeSetFiles(setId: string, entries: Entry[], preserveCurrentEntries = false): Promise<void> {
  const current = preserveCurrentEntries ? index?.sets[setId] : undefined;
  const currentHashes = new Set((current?.entries ?? []).map(entry => entry.hash));
  const obsoleteEntries = entries.filter(entry => !currentHashes.has(entry.hash));
  for (const entry of obsoleteEntries) {
    await removeFile(entry.file);
    ram.delete(ramKey(setId, entry.hash));
    removeTtsAudioFromMemory(entry.hash);
  }
  await removeTtsAudioCacheEntries(obsoleteEntries.map(entry => entry.hash));
  if (Capacitor.isNativePlatform() && !current?.entries.length) {
    try { await Filesystem.rmdir({ path: `${ROOT}/${safeId(setId)}`, directory: Directory.Data, recursive: true }); } catch { /* best effort */ }
  } else if (!Capacitor.isNativePlatform() && !current?.entries.length) {
    const prefix = `speakcoach.shadowing.audio.${ROOT}/${safeId(setId)}/`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(prefix)) keys.push(key); }
    keys.forEach(key => localStorage.removeItem(key));
  }
}

async function reconcile(): Promise<void> {
  if (!index) return;
  for (const [setId, set] of Object.entries(index.sets)) {
    const valid: Entry[] = [];
    for (const entry of set.entries) {
      if (Capacitor.isNativePlatform()) {
        try { const stat = await Filesystem.stat({ path: entry.file, directory: Directory.Data }); valid.push({ ...entry, size: stat.size ?? entry.size }); }
        catch { ram.delete(ramKey(setId, entry.hash)); }
      } else {
        const value = await readFile(entry.file);
        if (value) valid.push({ ...entry, size: value.length }); else ram.delete(ramKey(setId, entry.hash));
      }
    }
    set.entries = valid;
  }
  await removeOrphanSetFiles();
  await writeIndex();
}

async function removeOrphanSetFiles(): Promise<void> {
  const retained = new Set(Object.keys(index?.sets ?? {}).map(safeId));
  if (Capacitor.isNativePlatform()) {
    try {
      const listing = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
      for (const item of listing.files ?? []) {
        if (item.type === 'directory' && !retained.has(item.name)) {
          try { await Filesystem.rmdir({ path: `${ROOT}/${item.name}`, directory: Directory.Data, recursive: true }); } catch { /* best effort */ }
        }
      }
    } catch { /* root may not exist */ }
  } else if (typeof localStorage !== 'undefined') {
    const prefix = `speakcoach.shadowing.audio.${ROOT}/`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const remainder = key.slice(prefix.length);
      const directory = remainder.split('/')[0];
      if (!retained.has(directory)) localStorage.removeItem(key);
    }
  }
}

async function ensureInitialized(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const storedActive = (await Preferences.get({ key: ACTIVE_SET_KEY })).value;
      index = await readIndex();
      activeSetId = storedActive || index?.activeSetId || null;
      if (!index) index = { version: 2, activeSetId, sets: {} };
      index.activeSetId = activeSetId;
      if (activeSetId && !index.sets[activeSetId]) {
        const now = Date.now();
        index.sets[activeSetId] = { createdAt: now, lastUsedAt: now, entries: [] };
      }
      await reconcile();
      // Remove legacy keys only after the v2 index has been written successfully.
      await Preferences.remove({ key: LEGACY_INDEX_KEY });
    })().catch(error => { initialization = null; throw error; });
  }
  await initialization;
}

export async function initializeShadowingAudioStore(): Promise<void> {
  await ensureInitialized();
}

export function activateShadowingAudioSet(setId: string, meta?: { createdAt?: number }): Promise<number> {
  const task = activationQueue.then(async () => {
    await ensureInitialized();
    if (activeSetId === setId && index?.activeSetId === setId) return generation;
    if (activeSetId && index?.sets[activeSetId]?.entries.length === 0) delete index.sets[activeSetId];
    generation++;
    activeSetId = setId;
    index!.activeSetId = setId;
    const now = Date.now();
    const existing = index!.sets[setId];
    index!.sets[setId] = existing ?? { createdAt: meta?.createdAt ?? now, lastUsedAt: now, entries: [] };
    index!.sets[setId].lastUsedAt = now;
    ram.clear();
    await Preferences.set({ key: ACTIVE_SET_KEY, value: setId });
    await writeIndex();
    return generation;
  });
  activationQueue = task.then(() => {}, () => {});
  return task;
}

export async function getActiveShadowingAudioSet(): Promise<{ setId: string | null; generation: number }> {
  await ensureInitialized();
  return { setId: activeSetId, generation };
}
export async function readActiveShadowingAudio(hash: string, expectedSetId?: string): Promise<string | null> {
  await ensureInitialized();
  if (!activeSetId || (expectedSetId && expectedSetId !== activeSetId)) return null;
  const cached = ram.get(ramKey(activeSetId, hash));
  if (cached) return cached;
  const entry = activeSetId ? index?.sets[activeSetId]?.entries.find(item => item.hash === hash) : undefined;
  if (!entry) return null;
  const value = await readFile(entry.file);
  if (!value) {
    index!.sets[activeSetId!].entries = index!.sets[activeSetId!].entries.filter(item => item.hash !== hash);
    await writeIndex();
    return null;
  }
  rememberSetRam(activeSetId, hash, value);
  return value;
}
export async function persistActiveShadowingAudio(params: {
  setId: string;
  generation: number;
  hash: string;
  dataUrl: string;
  kind: 'sentence' | 'extra';
}): Promise<boolean> {
  await ensureInitialized();
  if (!params.dataUrl || params.setId !== activeSetId || params.generation !== generation || index?.activeSetId !== params.setId) return false;
  const set = index.sets[params.setId];
  if (!set) return false;
  const path = filePath(params.setId, params.hash);
  const existing = set.entries.find(entry => entry.hash === params.hash);
  const kind: Entry['kind'] = existing?.kind === 'sentence' || params.kind === 'sentence' ? 'sentence' : 'extra';
  const entriesWithoutCurrent = set.entries.filter(entry => entry.hash !== params.hash);
  const evictions = selectActiveSetAudioEvictions(entriesWithoutCurrent, params.dataUrl.length);
  for (const hash of evictions) {
    const extra = set.entries.find(entry => entry.hash === hash);
    if (extra) await removeFile(extra.file);
    ram.delete(ramKey(params.setId, hash));
    removeTtsAudioFromMemory(hash);
    set.entries = set.entries.filter(entry => entry.hash !== hash);
  }
  await removeTtsAudioCacheEntries(evictions);
  const total = set.entries.filter(entry => entry.hash !== params.hash).reduce((sum, entry) => sum + entry.size, 0);
  if (kind === 'extra' && total + params.dataUrl.length > MAX_SET_CHARS) return false;
  await writeFile(path, params.dataUrl);
  set.entries = set.entries.filter(entry => entry.hash !== params.hash);
  set.entries.push({ hash: params.hash, file: path, size: params.dataUrl.length, createdAt: Date.now(), kind });
  set.lastUsedAt = Date.now();
  rememberSetRam(params.setId, params.hash, params.dataUrl);
  await writeIndex();
  const audioSets = Object.entries(index.sets).filter(([, value]) => value.entries.length > 0);
  const evictionCandidates = audioSets.filter(([id]) => id !== activeSetId).sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (audioSets.length > MAX_RETAINED_AUDIO_SETS && evictionCandidates.length) {
    const candidate = evictionCandidates.shift();
    if (!candidate) break;
    const [evictedId, evicted] = candidate;
    delete index.sets[evictedId];
    audioSets.splice(audioSets.findIndex(([id]) => id === evictedId), 1);
    if (hasPlayingAudio(evictedId)) deferSetFiles(evictedId, evicted.entries);
    else await removeSetFiles(evictedId, evicted.entries);
  }
  await writeIndex();
  return true;
}

export async function clearActiveShadowingAudioStore(): Promise<void> {
  await ensureInitialized();
  generation++;
  for (const [setId, set] of Object.entries(index?.sets ?? {})) {
    if (hasPlayingAudio(setId)) deferSetFiles(setId, set.entries);
    else await removeSetFiles(setId, set.entries);
  }
  ram.clear();
  index = { version: 2, activeSetId, sets: {} };
  if (activeSetId) {
    const now = Date.now();
    index.sets[activeSetId] = { createdAt: now, lastUsedAt: now, entries: [] };
  }
  await writeIndex();
}

export function resetShadowingAudioStoreForTests(): void {
  activeSetId = null; generation = 0; index = null; initialization = null; activationQueue = Promise.resolve(); ram.clear(); playing.clear(); deferredSetDeletes.clear();
}
