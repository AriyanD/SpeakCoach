import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { removeTtsAudioFromMemory } from './audioCache';

const INDEX_KEY = 'speakcoach.shadowing.audio-set-index.v1';
const ACTIVE_SET_KEY = 'speakcoach.shadowing.audio-active-set.v1';
const ROOT = 'SpeakCoach/shadowing-audio';
const MAX_SET_CHARS = 80_000_000;

interface Entry {
  hash: string;
  file: string;
  size: number;
  createdAt: number;
  kind: 'sentence' | 'extra';
}
interface Index {
  setId: string;
  entries: Entry[];
}

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

async function readIndex(): Promise<Index | null> {
  try {
    const raw = (await Preferences.get({ key: INDEX_KEY })).value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Index;
    if (typeof parsed.setId !== 'string' || !Array.isArray(parsed.entries)) return null;
    return { setId: parsed.setId, entries: parsed.entries.filter(e =>
      e && typeof e.hash === 'string' && typeof e.file === 'string' &&
      typeof e.size === 'number' && (e.kind === 'sentence' || e.kind === 'extra')
    ) };
  } catch { return null; }
}
async function writeIndex(): Promise<void> {
  if (!index) return;
  await Preferences.set({ key: INDEX_KEY, value: JSON.stringify(index) });
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
      await removeSetFiles(setId, pending);
    }
  }
}

async function removeSetFiles(setId: string, entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    await removeFile(entry.file);
    ram.delete(ramKey(setId, entry.hash));
    removeTtsAudioFromMemory(entry.hash);
  }
  if (Capacitor.isNativePlatform()) {
    try { await Filesystem.rmdir({ path: `${ROOT}/${safeId(setId)}`, directory: Directory.Data, recursive: true }); } catch { /* empty or absent */ }
  }
}
async function reconcile(): Promise<void> {
  if (!index) return;
  const valid: Entry[] = [];
  for (const entry of index.entries) {
    const value = await readFile(entry.file);
    if (value) valid.push({ ...entry, size: value.length });
    else ram.delete(ramKey(index.setId, entry.hash));
  }
  index.entries = valid;
  if (Capacitor.isNativePlatform()) {
    try {
      const rootListing = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
      for (const item of rootListing.files ?? []) {
        if (item.type === 'directory' && item.name !== safeId(index.setId)) {
          try { await Filesystem.rmdir({ path: `${ROOT}/${item.name}`, directory: Directory.Data, recursive: true }); } catch { /* best-effort orphan cleanup */ }
        }
      }
    } catch { /* root directory may not exist yet */ }
    try {
      const listing = await Filesystem.readdir({ path: `${ROOT}/${safeId(index.setId)}`, directory: Directory.Data });
      const expected = new Set(valid.map(entry => entry.file.split('/').pop()));
      for (const item of listing.files ?? []) {
        if (item.type === 'file' && !expected.has(item.name)) {
          await removeFile(`${ROOT}/${safeId(index.setId)}/${item.name}`);
        }
      }
    } catch { /* directory may not exist yet */ }
  }
  await writeIndex();
}
async function removeOrphanSetFiles(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const rootListing = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
      for (const item of rootListing.files ?? []) {
        if (item.type === 'directory') {
          try { await Filesystem.rmdir({ path: `${ROOT}/${item.name}`, directory: Directory.Data, recursive: true }); } catch { /* best-effort cleanup */ }
        }
      }
    } catch { /* root directory may not exist */ }
  } else if (typeof localStorage !== 'undefined') {
    const prefix = `speakcoach.shadowing.audio.${ROOT}/`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  }
}

async function ensureInitialized(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const storedActive = (await Preferences.get({ key: ACTIVE_SET_KEY })).value;
      const storedIndex = await readIndex();
      activeSetId = storedActive || null;
      index = storedIndex && storedIndex.setId === activeSetId ? storedIndex : null;
      if (storedIndex && storedIndex.setId !== activeSetId) await removeSetFiles(storedIndex.setId, storedIndex.entries);
      if (activeSetId && !index) index = { setId: activeSetId, entries: [] };
      if (activeSetId) await reconcile();
      else {
        await removeOrphanSetFiles();
        await Preferences.remove({ key: INDEX_KEY });
      }
    })().catch(error => { initialization = null; throw error; });
  }
  await initialization;
}

export function activateShadowingAudioSet(setId: string): Promise<number> {
  const task = activationQueue.then(async () => {
    await ensureInitialized();
    if (activeSetId === setId && index?.setId === setId) return generation;
    if (index) {
      if (hasPlayingAudio(index.setId)) deferredSetDeletes.set(index.setId, [...index.entries]);
      else await removeSetFiles(index.setId, index.entries);
    }
    ram.clear();
    generation++;
    activeSetId = setId;
    index = { setId, entries: [] };
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
  const entry = index?.entries.find(item => item.hash === hash);
  if (!entry) return null;
  const value = await readFile(entry.file);
  if (!value) {
    index!.entries = index!.entries.filter(item => item.hash !== hash);
    await writeIndex();
    return null;
  }
  ram.set(ramKey(activeSetId, hash), value);
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
  if (!params.dataUrl || params.setId !== activeSetId || params.generation !== generation || index?.setId !== params.setId) return false;
  const path = filePath(params.setId, params.hash);
  const existing = index.entries.find(entry => entry.hash === params.hash);
  if (!existing) {
    // Preserve all canonical sentence audio. Evict slow/word replay extras first.
    const evictions = selectActiveSetAudioEvictions(index.entries, params.dataUrl.length);
    for (const hash of evictions) {
      const extra = index.entries.find(entry => entry.hash === hash);
      if (extra) await removeFile(extra.file);
      ram.delete(ramKey(params.setId, hash));
      removeTtsAudioFromMemory(hash);
      index.entries = index.entries.filter(entry => entry.hash !== hash);
    }
    const total = index.entries.reduce((sum, entry) => sum + entry.size, 0);
    // If sentence audio alone exceeds the budget, retain it rather than evicting
    // one of the active set's canonical sentences. Extras may be declined.
    if (params.kind === 'extra' && total + params.dataUrl.length > MAX_SET_CHARS) return false;
  }
  await writeFile(path, params.dataUrl);
  index.entries = index.entries.filter(entry => entry.hash !== params.hash);
  index.entries.push({ hash: params.hash, file: path, size: params.dataUrl.length, createdAt: Date.now(), kind: params.kind });
  ram.set(ramKey(params.setId, params.hash), params.dataUrl);
  await writeIndex();
  return true;
}
export async function clearActiveShadowingAudioStore(): Promise<void> {
  await ensureInitialized();
  generation++;
  if (index) {
    if (hasPlayingAudio(index.setId)) deferredSetDeletes.set(index.setId, [...index.entries]);
    else await removeSetFiles(index.setId, index.entries);
  }
  ram.clear();
  index = activeSetId ? { setId: activeSetId, entries: [] } : null;
  await writeIndex();
}
export function resetShadowingAudioStoreForTests(): void {
  activeSetId = null; generation = 0; index = null; initialization = null; activationQueue = Promise.resolve(); ram.clear(); playing.clear(); deferredSetDeletes.clear();
}
