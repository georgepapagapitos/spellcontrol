import { fetchSync, putSync, type SyncSnapshot } from './auth-api';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { usePlayStore } from '../store/play';
import {
  loadCollection,
  saveCollection,
  clearCollection,
  type StoredCollection,
} from './local-cards';
import type { Deck } from '../store/decks';
import type { BinderDef, EnrichedCard } from '../types';
import type { GameRecord } from './game-state';
import { consumeImmediateFlush } from './sync-intent';
import { fetchOracleIds } from './api/combos';

/**
 * Sync model: server is the source of truth for authed users.
 *
 * Local storage (zustand persist + IndexedDB) is a write-through cache plus a
 * dirty marker. On boot we hydrate the in-memory store from the cache BEFORE
 * any network decision, then sync in the background. The current store state
 * is the "pending push" payload; a single dirty flag in localStorage carries
 * unpushed-changes state across reloads.
 *
 * Invariants:
 *   • pushNow() refuses to run until cacheHydrated is true. This prevents an
 *     empty store (cards default to [] because zustand persist doesn't cover
 *     them) from overwriting a populated server.
 *   • applyServerSnapshot() is skipped if the user mutated state during the
 *     fetch window. Their intent wins; the next push reconciles.
 *   • Subscribers attach after cache hydration, so the hydration setState
 *     never triggers spurious pushes.
 */

const DEBOUNCE_MS = 500;
const VERSION_KEY = 'spellcontrol-sync-base-version';
const DIRTY_KEY = 'spellcontrol-sync-dirty';
const OWNER_KEY = 'spellcontrol-sync-owner';
const LEGACY_META_KEY = 'spellcontrol-sync-meta';

let currentVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let pushPending = false;
let isApplyingServer = false;
let cacheHydrated = false;
let mutationCount = 0;
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

function hasLocalData(): boolean {
  return (
    useCollectionStore.getState().binders.length > 0 ||
    useCollectionStore.getState().cards.length > 0 ||
    useDecksStore.getState().decks.length > 0 ||
    usePlayStore.getState().history.length > 0
  );
}

function isServerEmpty(snap: SyncSnapshot): boolean {
  return (
    !snap.collection &&
    (!Array.isArray(snap.binders) || snap.binders.length === 0) &&
    (!Array.isArray(snap.decks) || snap.decks.length === 0) &&
    (!Array.isArray(snap.games) || snap.games.length === 0)
  );
}

async function pushNow(): Promise<void> {
  if (pushing) {
    pushPending = true;
    return;
  }
  if (!cacheHydrated) {
    // Safety belt. The store may not yet reflect the IndexedDB cache, in
    // which case pushing would overwrite the server with empty cards. The
    // caller (startSync) is responsible for hydrating before allowing pushes.
    return;
  }
  if (!isDirty()) return;
  pushing = true;
  const countAtStart = mutationCount;
  try {
    const result = await putSync({
      collection: buildCollection(),
      binders: buildBinders(),
      decks: buildDecks(),
      games: buildGames(),
      baseVersion: currentVersion,
    });
    persistVersion(result.version);
    if (mutationCount === countAtStart) {
      // No mutation happened during the push round-trip — the payload we sent
      // is current. Clear the dirty marker. If a mutation DID happen, leave
      // dirty set so the finally-block reschedules a push.
      clearDirty();
    }
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
    const moreToPush = pushPending || mutationCount !== countAtStart;
    pushPending = false;
    if (moreToPush) {
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

async function hydrateFromCache(): Promise<void> {
  // Apply the IndexedDB-stored collection to the in-memory store. Wrapped in
  // isApplyingServer so attached subscribers (if any) don't observe this as a
  // user mutation. Cards live in IndexedDB only — zustand persist excludes
  // them due to size — so without this step pushNow() would see cards=[].
  isApplyingServer = true;
  try {
    let stored: StoredCollection | null = null;
    try {
      stored = await loadCollection();
    } catch (err) {
      console.warn('[sync] cache hydrate failed:', err);
    }
    if (stored) {
      useCollectionStore.setState({
        cards: stored.cards,
        fileName: stored.fileName,
        scryfallHits: stored.scryfallHits,
        scryfallMisses: stored.scryfallMisses,
        uploadedAt: stored.uploadedAt,
        importHistory: stored.importHistory ?? [],
        hydrating: false,
      });
    } else {
      // Nothing cached but mark hydration complete so the UI stops showing a
      // loading state.
      useCollectionStore.setState({ hydrating: false });
    }
  } finally {
    isApplyingServer = false;
    cacheHydrated = true;
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
  if (!cacheHydrated) return;
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
    if (isApplyingServer) return;
    mutationCount++;
    schedulePush();
  });
  const u2 = useDecksStore.subscribe((state, prev) => {
    if (state.decks === prev.decks) return;
    if (isApplyingServer) return;
    mutationCount++;
    schedulePush();
  });
  const u3 = usePlayStore.subscribe((state, prev) => {
    if (state.history === prev.history) return;
    if (isApplyingServer) return;
    mutationCount++;
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
 * Pull the server snapshot and reconcile with local state. Called once after
 * login.
 *
 * Flow:
 *   1. Hydrate IndexedDB cache into the store (so cards reflect reality).
 *   2. Attach subscribers (so user mutations during the fetch get observed).
 *   3. If dirty (unpushed local changes), push them.
 *   4. Fetch server snapshot.
 *   5. Reconcile:
 *      - If user mutated during the fetch window: skip server apply, just
 *        record the new base version. The user's push is already queued.
 *      - Else if server is empty and we have local data: promote local
 *        (handles guest → authed signup flow).
 *      - Else: apply server snapshot (overwrite).
 */
export async function startSync(userId?: string): Promise<void> {
  syncedState = 'syncing';
  emitSynced();

  // Drop legacy sync-meta from the pre-#153 merge era.
  try {
    localStorage.removeItem(LEGACY_META_KEY);
  } catch {
    /* ignore */
  }

  // Cross-user safety: if persisted state belongs to a different user, wipe
  // before contaminating their account.
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
  }

  loadVersion();
  await hydrateFromCache();
  attachSubscribers();

  // Push any unpushed local changes first, so the server reflects the most
  // recent local intent before we apply the fetched snapshot.
  if (isDirty()) {
    await pushNow();
  }

  const mutationCountAtFetchStart = mutationCount;

  let snap: SyncSnapshot | null = null;
  try {
    snap = await fetchSync();
  } catch (err) {
    console.warn('[sync] fetch on startSync failed:', err);
  }

  if (snap) {
    if (mutationCount !== mutationCountAtFetchStart) {
      // The user mutated state during the fetch window. Their intent is
      // fresher than the server's reply — don't overwrite. Just record the
      // server's version so the next push uses the right base. Their push
      // is already queued by the subscriber.
      persistVersion(snap.version);
    } else if (isServerEmpty(snap) && hasLocalData()) {
      // Guest promotion path: a newly authed user has local data but the
      // server account is empty. Push local up.
      persistVersion(snap.version);
      setDirty();
      await pushNow();
    } else {
      await applyServerSnapshot(snap);
    }
  }

  syncedState = 'ready';
  emitSynced();

  // Fire-and-forget: cards saved before EnrichedCard.oracleId existed don't
  // carry one. Backfill from the server's Scryfall cache so the combo panel
  // can join against the dataset without forcing a re-import. Silent — no
  // sync push, no UI spinner; combo features just become more accurate as
  // ids land.
  void backfillOracleIds().catch((err) => {
    console.warn('[sync] oracle-id backfill failed:', err);
  });
}

const ORACLE_BACKFILL_CHUNK = 1000;

async function backfillOracleIds(): Promise<void> {
  const cards = useCollectionStore.getState().cards;
  // Unique scryfallIds whose card lacks an oracleId.
  const missingIds = new Set<string>();
  for (const c of cards) {
    if (!c.oracleId && c.scryfallId) missingIds.add(c.scryfallId);
  }
  if (missingIds.size === 0) return;

  const allIds = Array.from(missingIds);
  const resolved = new Map<string, string>();
  for (let i = 0; i < allIds.length; i += ORACLE_BACKFILL_CHUNK) {
    const chunk = allIds.slice(i, i + ORACLE_BACKFILL_CHUNK);
    try {
      const map = await fetchOracleIds(chunk);
      for (const [k, v] of Object.entries(map)) resolved.set(k, v);
    } catch (err) {
      console.warn('[sync] oracle-id chunk failed:', err);
      return;
    }
  }
  if (resolved.size === 0) return;

  // Patch the store silently — flagged so subscribers don't queue a push.
  isApplyingServer = true;
  try {
    const current = useCollectionStore.getState().cards;
    let changed = 0;
    const next: EnrichedCard[] = current.map((c) => {
      if (c.oracleId || !c.scryfallId) return c;
      const oid = resolved.get(c.scryfallId);
      if (!oid) return c;
      changed++;
      return { ...c, oracleId: oid };
    });
    if (changed > 0) {
      useCollectionStore.setState({ cards: next });
      // Persist to IndexedDB so the next boot sees the enriched cards
      // without re-running the backfill.
      const stored = buildCollection();
      if (stored) await saveCollection(stored);
      console.log(`[sync] oracle-id backfill enriched ${changed} cards`);
    }
  } finally {
    isApplyingServer = false;
  }
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
  cacheHydrated = false;
  mutationCount = 0;
  clearDirty();
  for (const key of [VERSION_KEY, OWNER_KEY, LEGACY_META_KEY]) {
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
