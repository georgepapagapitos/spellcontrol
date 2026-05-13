import { fetchSync, putSync, type SyncSnapshot } from './auth-api';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import { saveCollection, clearCollection, type StoredCollection } from './local-cards';
import type { Deck } from '../store/decks';
import type { BinderDef } from '../types';
import type { GameRecord } from './game-state';
import { consumeImmediateFlush } from './sync-intent';

/**
 * Sync model: server is the source of truth for authed users.
 *
 * Local storage (zustand persist + IndexedDB) is treated as a cache for fast
 * reload and offline reads. It is never merged with the server. The store's
 * current state IS the "pending push" payload; a single dirty flag in
 * localStorage records whether there are unpushed changes across reloads.
 *
 *   • startSync(userId): if dirty (or this is a new owner), push current state.
 *     Then fetch server and overwrite stores. On 409: server wins for the
 *     refresh, then re-push our current state on top.
 *   • Subscribers: any store change marks dirty and schedules a push.
 *     Destructive mutators (clearCards, deleteBinder, ...) flag the next push
 *     as immediate via sync-intent, bypassing the debounce.
 */

const DEBOUNCE_MS = 500;
const VERSION_KEY = 'spellcontrol-sync-base-version';
const DIRTY_KEY = 'spellcontrol-sync-dirty';
const OWNER_KEY = 'spellcontrol-sync-owner';

let currentVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let pushPending = false;
let isApplyingServer = false;
let unsubscribers: Array<() => void> = [];

type SyncedListener = () => void;
const syncedListeners = new Set<SyncedListener>();
let syncedState: 'idle' | 'syncing' | 'ready' = 'idle';

export function onSyncedChange(fn: SyncedListener): () => void {
  syncedListeners.add(fn);
  return () => syncedListeners.delete(fn);
}
function emitSynced(): void {
  for (const fn of syncedListeners) fn();
}
export function getSyncState(): 'idle' | 'syncing' | 'ready' {
  return syncedState;
}

function setDirty(): void {
  try {
    localStorage.setItem(DIRTY_KEY, '1');
  } catch {
    /* ignore */
  }
}
function clearDirty(): void {
  try {
    localStorage.removeItem(DIRTY_KEY);
  } catch {
    /* ignore */
  }
}
function isDirty(): boolean {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}
function persistVersion(v: number): void {
  currentVersion = v;
  try {
    localStorage.setItem(VERSION_KEY, String(v));
  } catch {
    /* ignore */
  }
}
function loadVersion(): void {
  try {
    const raw = localStorage.getItem(VERSION_KEY);
    currentVersion = raw ? Number.parseInt(raw, 10) || 0 : 0;
  } catch {
    currentVersion = 0;
  }
}

function buildBinders(): BinderDef[] {
  return useCollectionStore.getState().binders;
}

function buildDecks(): Deck[] {
  return useDecksStore.getState().decks;
}

function buildGames(): GameRecord[] {
  return usePlayStore.getState().history;
}

function buildCollection(): StoredCollection | null {
  const s = useCollectionStore.getState();
  if (!s.cards.length && !s.fileName && !s.uploadedAt) return null;
  return {
    fileName: s.fileName,
    cards: s.cards,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
  };
}

async function pushNow(): Promise<void> {
  if (pushing) {
    pushPending = true;
    return;
  }
  if (!isDirty()) return;
  pushing = true;
  try {
    const result = await putSync({
      collection: buildCollection(),
      binders: buildBinders(),
      decks: buildDecks(),
      games: buildGames(),
      baseVersion: currentVersion,
    });
    persistVersion(result.version);
    clearDirty();
  } catch (err) {
    const e = err as Error & { status?: number; current?: SyncSnapshot };
    if (e.status === 409 && e.current) {
      // Server moved on. Re-base on its version, then re-push our current
      // local state on top. Last-write-wins for the values we touched.
      persistVersion(e.current.version);
      pushPending = true;
    } else {
      // Network or other failure — keep dirty. Retry on next mutation or
      // on the next online event.
      console.warn('[sync] push failed:', err);
    }
  } finally {
    pushing = false;
    if (pushPending) {
      pushPending = false;
      schedulePush(true);
    }
  }
}

function schedulePush(immediate = false): void {
  if (isApplyingServer) return;
  setDirty();
  const forceImmediate = immediate || consumeImmediateFlush();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (forceImmediate) {
    void pushNow();
  } else {
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushNow();
    }, DEBOUNCE_MS);
  }
}

async function applyServerSnapshot(snap: SyncSnapshot): Promise<void> {
  isApplyingServer = true;
  try {
    persistVersion(snap.version);
    const remoteBinders = Array.isArray(snap.binders) ? (snap.binders as BinderDef[]) : [];
    const remoteDecks = Array.isArray(snap.decks)
      ? (snap.decks as Deck[]).map((d) => ({
          ...d,
          format: d.format ?? 'commander',
          sideboard: d.sideboard ?? [],
        }))
      : [];
    const remoteCollection = (snap.collection as StoredCollection | null) ?? null;
    const remoteGames = Array.isArray(snap.games) ? (snap.games as GameRecord[]) : [];

    if (remoteCollection) {
      await saveCollection(remoteCollection);
    } else {
      await clearCollection();
    }

    useCollectionStore.setState({
      binders: remoteBinders,
      cards: remoteCollection?.cards ?? [],
      fileName: remoteCollection?.fileName ?? '',
      scryfallHits: remoteCollection?.scryfallHits ?? 0,
      scryfallMisses: remoteCollection?.scryfallMisses ?? 0,
      uploadedAt: remoteCollection?.uploadedAt ?? null,
      importHistory: remoteCollection?.importHistory ?? [],
      hydrating: false,
    });
    useDecksStore.setState({ decks: remoteDecks, hydrated: true });
    usePlayStore.setState({ history: remoteGames });
  } finally {
    isApplyingServer = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden' && pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    void pushNow();
  }
}

function handleBeforeUnload(): void {
  if (!pushTimer && !pushing && !isDirty()) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (!isDirty()) return;
  try {
    const payload = JSON.stringify({
      collection: buildCollection(),
      binders: buildBinders(),
      decks: buildDecks(),
      games: buildGames(),
      baseVersion: currentVersion,
    });
    fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {
      /* best effort */
    });
  } catch {
    /* payload too large — dirty flag stays set, retried on next boot */
  }
}

function handleOnline(): void {
  if (isDirty()) schedulePush(true);
}

function attachSubscribers(): void {
  detachSubscribers();
  const u1 = useCollectionStore.subscribe((state, prev) => {
    if (state.binders === prev.binders && state.cards === prev.cards) return;
    schedulePush();
  });
  const u2 = useDecksStore.subscribe((state, prev) => {
    if (state.decks === prev.decks) return;
    schedulePush();
  });
  const u3 = usePlayStore.subscribe((state, prev) => {
    if (state.history === prev.history) return;
    schedulePush();
  });
  unsubscribers = [u1, u2, u3];
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('online', handleOnline);
}

function detachSubscribers(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('online', handleOnline);
  }
}

/**
 * Pull the server snapshot and overwrite local state. Called once after login.
 *
 * Pass the authed user's id so we can detect cross-user persisted state and
 * wipe it before pushing to the wrong account.
 */
export async function startSync(userId?: string): Promise<void> {
  syncedState = 'syncing';
  emitSynced();

  // Migrate legacy sync-meta from the merge era — no longer used.
  try {
    localStorage.removeItem('spellcontrol-sync-meta');
  } catch {
    /* ignore */
  }

  // Cross-user safety: if persist'd state belongs to a different user, wipe
  // before we contaminate their account with the previous user's snapshot.
  // (The normal logout flow already wipes; this guards against stale cookies
  // and edge cases.)
  if (userId) {
    let owner: string | null = null;
    try {
      owner = localStorage.getItem(OWNER_KEY);
    } catch {
      /* ignore */
    }
    if (owner && owner !== userId) {
      await wipeLocal();
    }
    try {
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      /* ignore */
    }
    // First sync after switching from guest (no prior owner): treat local
    // state as a pending push so guest binders/decks are promoted into the
    // newly authed account.
    if (!owner) {
      const hasLocal =
        useCollectionStore.getState().binders.length > 0 ||
        useDecksStore.getState().decks.length > 0 ||
        useCollectionStore.getState().cards.length > 0 ||
        usePlayStore.getState().history.length > 0;
      if (hasLocal) setDirty();
    }
  }

  loadVersion();

  // If we have unpushed local changes, send them first. Server is then
  // guaranteed to reflect the user's most recent intent before we overwrite
  // the store from a fetch.
  if (isDirty()) {
    await pushNow();
  }

  // Fetch the authoritative snapshot and overwrite local state. No merge.
  try {
    const snap = await fetchSync();
    await applyServerSnapshot(snap);
    // If our push above didn't run or didn't fully cover our state, the
    // subscriber chain hasn't been attached yet so the overwrite is clean.
  } catch (err) {
    console.warn('[sync] fetch on startSync failed:', err);
  }

  attachSubscribers();
  syncedState = 'ready';
  emitSynced();
}

/**
 * Stop subscribing and wipe local persistence so a future user starts clean.
 * Called on logout.
 */
export async function stopSyncAndWipeLocal(): Promise<void> {
  detachSubscribers();
  await wipeLocal();
  syncedState = 'idle';
  emitSynced();
}

async function wipeLocal(): Promise<void> {
  currentVersion = 0;
  clearDirty();
  for (const key of [VERSION_KEY, OWNER_KEY, 'spellcontrol-sync-meta']) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  await clearCollection();
  useCollectionStore.setState({
    binders: [],
    cards: [],
    fileName: '',
    scryfallHits: 0,
    scryfallMisses: 0,
    uploadedAt: null,
    importHistory: [],
    hydrating: false,
  });
  useDecksStore.setState({ decks: [], hydrated: true });
  usePlayStore.getState().clearOnline();
  usePlayStore.setState({ local: null, history: [], hydrated: true });
  for (const key of ['spellcontrol', 'mtg-decks', 'mtg-play']) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Force an immediate push, bypassing the debounce. Used on logout-time flush. */
export async function flushSync(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushNow();
}
