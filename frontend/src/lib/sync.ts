import { fetchSync, putSync, type SyncSnapshot } from './auth-api';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import { saveCollection, clearCollection, type StoredCollection } from './local-cards';
import type { Deck } from '../store/decks';
import type { BinderDef } from '../types';
import type { GameRecord } from './game-state';
import {
  mergeBinders,
  mergeDecks,
  mergeCollection,
  buildSyncMeta,
  saveSyncMeta,
  loadSyncMeta,
  setDirty,
  clearDirty,
} from './sync-merge';

const PUSH_DEBOUNCE_MS = 1500;

let currentVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let pushPending = false;
let isApplyingRemote = false;
let unsubscribers: Array<() => void> = [];

function buildBindersSnapshot(): BinderDef[] {
  return useCollectionStore.getState().binders;
}

function buildDecksSnapshot(): Deck[] {
  return useDecksStore.getState().decks;
}

function buildGamesSnapshot(): GameRecord[] {
  return usePlayStore.getState().history;
}

/**
 * Merge game records by id. Each record is immutable once written (a finished
 * game never changes), so union-by-id with the most recent endedAt as the
 * tiebreaker is sufficient. The result is sorted newest-first.
 */
function mergeGameRecords(local: GameRecord[], remote: GameRecord[]): GameRecord[] {
  const byId = new Map<string, GameRecord>();
  for (const r of remote) byId.set(r.id, r);
  for (const r of local) {
    const cur = byId.get(r.id);
    if (!cur || r.endedAt > cur.endedAt) byId.set(r.id, r);
  }
  return Array.from(byId.values()).sort((a, b) => b.endedAt - a.endedAt);
}

function buildCollectionSnapshot(): StoredCollection | null {
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
  pushing = true;
  try {
    const binders = buildBindersSnapshot();
    const decks = buildDecksSnapshot();
    const games = buildGamesSnapshot();
    const collection = buildCollectionSnapshot();
    const result = await putSync({
      collection,
      binders,
      decks,
      games,
      baseVersion: currentVersion,
    });
    currentVersion = result.version;
    saveSyncMeta(buildSyncMeta(result.version, binders, decks, collection));
    clearDirty();
  } catch (err) {
    const e = err as Error & { status?: number; current?: SyncSnapshot };
    if (e.status === 409 && e.current) {
      await mergeWithSnapshot(e.current);
      pushPending = true;
    } else {
      console.warn('[sync] push failed:', err);
    }
  } finally {
    pushing = false;
    if (pushPending) {
      pushPending = false;
      schedulePush();
    }
  }
}

function schedulePush(): void {
  if (isApplyingRemote) return;
  setDirty();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, PUSH_DEBOUNCE_MS);
}

async function mergeWithSnapshot(snap: SyncSnapshot): Promise<void> {
  isApplyingRemote = true;
  try {
    currentVersion = snap.version;
    const meta = loadSyncMeta();

    const localBinders = useCollectionStore.getState().binders;
    const localDecks = useDecksStore.getState().decks;
    const localCollection = buildCollectionSnapshot();

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

    const mergedBinders = mergeBinders(localBinders, remoteBinders, meta);
    const mergedDecks = mergeDecks(localDecks, remoteDecks, meta);
    const mergedCollection = mergeCollection(localCollection, remoteCollection);
    const mergedGames = mergeGameRecords(usePlayStore.getState().history, remoteGames);

    if (mergedCollection !== localCollection) {
      if (mergedCollection) await saveCollection(mergedCollection);
      else await clearCollection();
    }

    useCollectionStore.setState({
      binders: mergedBinders,
      cards: mergedCollection?.cards ?? [],
      fileName: mergedCollection?.fileName ?? '',
      scryfallHits: mergedCollection?.scryfallHits ?? 0,
      scryfallMisses: mergedCollection?.scryfallMisses ?? 0,
      uploadedAt: mergedCollection?.uploadedAt ?? null,
      importHistory: mergedCollection?.importHistory ?? [],
      hydrating: false,
    });
    useDecksStore.setState({ decks: mergedDecks, hydrated: true });
    usePlayStore.setState({ history: mergedGames });

    saveSyncMeta(buildSyncMeta(snap.version, mergedBinders, mergedDecks, mergedCollection));
  } finally {
    isApplyingRemote = false;
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
  if (!pushTimer && !pushing) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  try {
    const payload = JSON.stringify({
      collection: buildCollectionSnapshot(),
      binders: buildBindersSnapshot(),
      decks: buildDecksSnapshot(),
      games: buildGamesSnapshot(),
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
    /* payload too large or other error — dirty flag remains set */
  }
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
}

function detachSubscribers(): void {
  for (const u of unsubscribers) u();
  unsubscribers = [];
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('beforeunload', handleBeforeUnload);
}

/**
 * Pull the server snapshot and merge with local state. Called once after login.
 */
export async function startSync(): Promise<void> {
  const snap = await fetchSync();

  const serverIsEmpty =
    !snap.collection &&
    (!Array.isArray(snap.binders) || snap.binders.length === 0) &&
    (!Array.isArray(snap.decks) || snap.decks.length === 0) &&
    (!Array.isArray(snap.games) || snap.games.length === 0);

  if (serverIsEmpty) {
    currentVersion = snap.version;
    attachSubscribers();
    schedulePush();
    return;
  }

  await mergeWithSnapshot(snap);
  attachSubscribers();

  // If the merge picked any local-wins, push the merged state to the server.
  const remoteBinders = Array.isArray(snap.binders) ? (snap.binders as BinderDef[]) : [];
  const remoteDecks = Array.isArray(snap.decks) ? (snap.decks as Deck[]) : [];
  const mergedBinders = useCollectionStore.getState().binders;
  const mergedDecks = useDecksStore.getState().decks;

  const changed =
    mergedBinders.length !== remoteBinders.length ||
    mergedDecks.length !== remoteDecks.length ||
    mergedBinders.some(
      (b, i) =>
        b.id !== (remoteBinders[i]?.id ?? '') || b.updatedAt !== (remoteBinders[i]?.updatedAt ?? 0)
    ) ||
    mergedDecks.some(
      (d, i) =>
        d.id !== (remoteDecks[i]?.id ?? '') || d.updatedAt !== (remoteDecks[i]?.updatedAt ?? 0)
    );

  if (changed) {
    schedulePush();
  }
}

/**
 * Stop subscribing and wipe local persistence so a future user starts clean.
 * Called on logout.
 */
export async function stopSyncAndWipeLocal(): Promise<void> {
  detachSubscribers();
  currentVersion = 0;
  clearDirty();
  try {
    localStorage.removeItem('spellcontrol-sync-meta');
  } catch {
    /* ignore */
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
  try {
    localStorage.removeItem('spellcontrol');
    localStorage.removeItem('mtg-decks');
    localStorage.removeItem('mtg-play');
  } catch {
    /* ignore */
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
