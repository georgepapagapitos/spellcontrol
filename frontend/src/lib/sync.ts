import { logger } from '@/lib/logger';
import { fetchSync, putSync, type SyncSnapshot } from './auth-api';
import { apiUrl } from './api-base';
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
import { consumeImmediateFlush, peekDestructive, consumeDestructive } from './sync-intent';
import { reconcileBinderRefs } from './binder-refs';
import { invokeCollisionHandler } from './sync-collision';
import { mergeSnapshots, countLocal, countServer, type LocalSnapshot } from './sync-merge';

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

let currentVersion = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let pushPending = false;
let isApplyingServer = false;
let cacheHydrated = false;
// True when the most recent hydrateFromCache() could NOT read IndexedDB
// (threw — quota, private mode, iOS cold-start empty-read). In that state the
// in-memory store does NOT reflect reality, so it must never drive a push
// (collection: null) or a destructive server-empty reconcile. Distinct from a
// genuinely-empty cache, where the store IS authoritative.
let hydrateFailed = false;
let mutationCount = 0;
let unsubscribers: Array<() => void> = [];

// Refetch-on-focus: there is no live sync/polling, so a device only sees other
// devices' changes when it next pulls. We pull when the tab becomes visible
// again. `pulling` prevents overlap; the throttle prevents hammering on rapid
// tab switching. lastPullAt is managed only by the focus path so the first
// focus right after startSync still refreshes.
let pulling = false;
let lastPullAt = 0;
const FOCUS_PULL_THROTTLE_MS = 3000;

// True for the *first* pull right after startSync(userId) when this device
// had no prior owner — i.e. a guest just signed in. Drives the
// guest-into-populated-account collision prompt: the silent server-overwrite
// only happens on that single pull, never on focus refreshes.
let firstPullPending = false;
// Label shown in the collision dialog (account username). Set by startSync.
let currentAccountLabel = '';

type SyncedListener = () => void;
const syncedListeners = new Set<SyncedListener>();
let syncedState: 'idle' | 'syncing' | 'ready' = 'idle';
// Epoch ms of the last successful pull OR push. Both count as "synced":
// the user only cares that local and server are in agreement, not which
// direction the bytes flowed. Reset to null by wipeLocal() so a logged-out
// device doesn't show a stale "synced 3m ago" stamp.
let lastSyncedAt: number | null = null;

// We keep the existing parameterless onSyncedChange API and just bump it on
// every change (state or lastSyncedAt). Subscribers re-read both getters in
// their handler — simpler than encoding a payload type that consumers would
// pattern-match on, and avoids fanning out two listener channels.
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
export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}
function markSynced(): void {
  lastSyncedAt = Date.now();
  emitSynced();
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
  // Lists ride inside this blob, so a user with lists but no imported
  // collection still has data worth persisting — returning null here would
  // drop the lists on every push.
  if (!s.cards.length && !s.fileName && !s.uploadedAt && !s.lists.length) return null;
  return {
    fileName: s.fileName,
    cards: s.cards,
    scryfallHits: s.scryfallHits,
    scryfallMisses: s.scryfallMisses,
    uploadedAt: s.uploadedAt ?? Date.now(),
    importHistory: s.importHistory,
    lists: s.lists,
  };
}

function hasLocalData(): boolean {
  return (
    useCollectionStore.getState().binders.length > 0 ||
    useCollectionStore.getState().cards.length > 0 ||
    useCollectionStore.getState().lists.length > 0 ||
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

  const collection = buildCollection();
  const binders = buildBinders();
  const decks = buildDecks();
  const games = buildGames();
  // Root data-loss guard. A blank-slate payload (nothing at all) must never
  // overwrite the server unless an explicit user deletion produced it. Every
  // incident in this saga — failed/empty IndexedDB hydrate, the "loads then
  // wipes after 2s", post-signout re-login pushing emptiness — is a
  // non-destructive empty state being PUT as if it were the truth. Refuse it;
  // the server stays authoritative and startSync's fetch (or the next online
  // event) repopulates this device.
  if (
    !collection &&
    binders.length === 0 &&
    decks.length === 0 &&
    games.length === 0 &&
    !peekDestructive()
  ) {
    logger.warn('[sync] refused blank push (no explicit deletion) — server stays source of truth');
    // Don't spin retrying a push we will never send. Real local data will
    // re-arm the dirty flag through the normal subscriber path.
    clearDirty();
    return;
  }

  pushing = true;
  const countAtStart = mutationCount;
  try {
    const result = await putSync({
      collection,
      binders,
      decks,
      games,
      baseVersion: currentVersion,
    });
    persistVersion(result.version);
    if (mutationCount === countAtStart) {
      // No mutation happened during the push round-trip — the payload we sent
      // is current. Clear the dirty marker. If a mutation DID happen, leave
      // dirty set so the finally-block reschedules a push.
      clearDirty();
      // The deletion (if any) is now durably accepted — drop the latch so a
      // later non-destructive empty state can't ride on stale intent.
      consumeDestructive();
    }
    markSynced();
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
      logger.warn('[sync] push failed:', err);
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

/**
 * Re-resolve binder pin/exclusion refs against a new collection using their
 * durable key shadow. Mirrors collection.ts's remapBinderRefs but lives here
 * because the real app-load path is sync.ts (the collection store's
 * hydrateCards action is unused). Called inside isApplyingServer so the write
 * isn't observed as a user mutation / spurious push.
 */
function reconcileBinders(prevCards: EnrichedCard[], newCards: EnrichedCard[]): void {
  const { binders } = useCollectionStore.getState();
  if (binders.length === 0) return;
  const result = reconcileBinderRefs(binders, newCards, prevCards);
  if (result.changed) useCollectionStore.setState({ binders: result.binders });
}

async function hydrateFromCache(): Promise<void> {
  // Apply the IndexedDB-stored collection to the in-memory store. Wrapped in
  // isApplyingServer so attached subscribers (if any) don't observe this as a
  // user mutation. Cards live in IndexedDB only — zustand persist excludes
  // them due to size — so without this step pushNow() would see cards=[].
  isApplyingServer = true;
  hydrateFailed = false;
  const prevCards = useCollectionStore.getState().cards;
  try {
    let stored: StoredCollection | null = null;
    try {
      stored = await loadCollection();
    } catch (err) {
      // Could not READ the cache (vs. cache being legitimately empty, which
      // resolves to null without throwing). The store is now NOT trustworthy.
      hydrateFailed = true;
      logger.warn('[sync] cache hydrate failed:', err);
    }
    if (stored) {
      useCollectionStore.setState({
        cards: stored.cards,
        fileName: stored.fileName,
        scryfallHits: stored.scryfallHits,
        scryfallMisses: stored.scryfallMisses,
        uploadedAt: stored.uploadedAt,
        importHistory: stored.importHistory,
        lists: stored.lists,
        hydrating: false,
      });
      // Re-resolve binder pins/exclusions from their durable key shadow against
      // the cards just loaded from IndexedDB. On a normal load the copyIds
      // match and this just backfills keys (immunizing the current good state);
      // after a loss + re-cache it re-binds pins to the equivalent new copies.
      reconcileBinders(prevCards, stored.cards);
    } else {
      // Nothing cached but mark hydration complete so the UI stops showing a
      // loading state.
      useCollectionStore.setState({ hydrating: false });
    }
  } finally {
    isApplyingServer = false;
    // Only enable pushes if we actually KNOW the local state (loaded data or a
    // confirmed-empty cache). A failed read leaves cacheHydrated false so
    // pushNow()'s existing safety belt blocks a destructive collection: null
    // push — restoring the invariant documented at the top of this file.
    cacheHydrated = !hydrateFailed;
  }
}

async function applyServerSnapshot(
  snap: SyncSnapshot,
  opts: { keepLocalCollection?: boolean } = {}
): Promise<void> {
  isApplyingServer = true;
  const prevCards = useCollectionStore.getState().cards;
  try {
    persistVersion(snap.version);
    const remoteBinders = Array.isArray(snap.binders) ? (snap.binders as BinderDef[]) : [];
    const remoteDecks = Array.isArray(snap.decks) ? (snap.decks as Deck[]) : [];
    const remoteCollection = (snap.collection as StoredCollection | null) ?? null;
    const remoteGames = Array.isArray(snap.games) ? (snap.games as GameRecord[]) : [];

    if (remoteCollection) {
      await saveCollection(remoteCollection);
    }
    // Deliberately NOT clearing IndexedDB when the server has no collection. A
    // null server reply must never destroy the local cache: the only ways we
    // legitimately reach here with a null collection are (a) the cache is
    // already empty (nothing to clear) or (b) a bug we refuse to amplify into
    // permanent data loss. Real deletion is explicit and lives in
    // clearCards() / wipeLocal(). Regression guard for the #153-class bug.

    if (opts.keepLocalCollection) {
      // The server lost the collection but still has other slices (binders),
      // so isServerEmpty() is false and the whole-snapshot promotion guard
      // doesn't fire. Apply the server's non-collection slices but KEEP the
      // local collection (still in the store + IndexedDB) — blanking it here
      // is the "loads then wipes after ~2s" bug. The caller re-pushes the
      // kept collection to repair the server.
      const keptCards = useCollectionStore.getState().cards;
      useCollectionStore.setState({ binders: remoteBinders, hydrating: false });
      useDecksStore.setState({ decks: remoteDecks, hydrated: true });
      usePlayStore.setState({ history: remoteGames });
      // Re-resolve the (server) binders' durable key shadow against the kept
      // local collection so pins/exclusions point at owned copies.
      reconcileBinders(prevCards, keptCards);
      return;
    }

    useCollectionStore.setState({
      binders: remoteBinders,
      cards: remoteCollection?.cards ?? [],
      fileName: remoteCollection?.fileName ?? '',
      scryfallHits: remoteCollection?.scryfallHits ?? 0,
      scryfallMisses: remoteCollection?.scryfallMisses ?? 0,
      uploadedAt: remoteCollection?.uploadedAt ?? null,
      importHistory: remoteCollection?.importHistory ?? [],
      lists: remoteCollection?.lists ?? [],
      hydrating: false,
    });
    useDecksStore.setState({ decks: remoteDecks, hydrated: true });
    usePlayStore.setState({ history: remoteGames });
    // Server binders + collection are internally consistent (pushed together),
    // so this is usually a no-op; its job is to backfill the durable key
    // shadow on snapshots that predate it, so a later loss is recoverable.
    reconcileBinders(prevCards, remoteCollection?.cards ?? []);
  } finally {
    isApplyingServer = false;
  }
}

/**
 * Best-effort push that survives the page being suspended/discarded: fetch
 * keepalive lets the request outlive the document. Guarded so it can never
 * send a destructive collection: null when the cache could not be read
 * (cacheHydrated is false on failed/pre hydrate).
 */
function keepaliveFlush(): void {
  if (!cacheHydrated) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (!isDirty()) return;
  const collection = buildCollection();
  const binders = buildBinders();
  const decks = buildDecks();
  const games = buildGames();
  // Same root guard as pushNow(): never let a blank-slate snapshot escape on
  // backgrounding/unload unless an explicit deletion produced it.
  if (
    !collection &&
    binders.length === 0 &&
    decks.length === 0 &&
    games.length === 0 &&
    !peekDestructive()
  ) {
    return;
  }
  try {
    const payload = JSON.stringify({
      collection,
      binders,
      decks,
      games,
      baseVersion: currentVersion,
    });
    fetch(apiUrl('/api/sync'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {
      /* best effort — dirty flag stays set, reconciled on next boot */
    });
  } catch {
    /* payload too large for keepalive — dirty flag stays set, retried on boot */
  }
}

/**
 * Pull the latest server state when the app is brought back to the foreground
 * so another device's changes show up without a manual reload. Pushes any
 * pending local edits first so the pull can't revert unsynced work, then runs
 * the shared reconcile (all the same guards as startSync).
 */
async function handleVisible(): Promise<void> {
  // The initial startSync owns the first pull; only run once it's done.
  if (syncedState !== 'ready') return;
  if (pulling) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const now = Date.now();
  if (now - lastPullAt < FOCUS_PULL_THROTTLE_MS) return;
  lastPullAt = now;
  pulling = true;
  try {
    if (isDirty()) await pushNow();
    await pullAndReconcile();
  } finally {
    pulling = false;
  }
}

function handleVisibilityChange(): void {
  // iOS Safari does NOT reliably fire beforeunload/pagehide when the user
  // switches apps; visibilitychange→hidden is the one signal we can count on.
  // It MUST use keepalive — the previous plain pushNow() fetch was killed when
  // the tab suspended, which is exactly the "collection vanishes after
  // app-switch" report.
  if (document.visibilityState === 'hidden') {
    keepaliveFlush();
  } else if (document.visibilityState === 'visible') {
    // Coming back to the foreground — pull other devices' changes.
    void handleVisible();
  }
}

function handlePageHide(): void {
  keepaliveFlush();
}

function handleBeforeUnload(): void {
  keepaliveFlush();
}

function handleOnline(): void {
  if (isDirty()) schedulePush(true);
}

function attachSubscribers(): void {
  detachSubscribers();
  const u1 = useCollectionStore.subscribe((state, prev) => {
    // `lists` is part of the synced collection blob but lives in its own
    // store slice — without it here, creating/editing a list mutates state
    // but never arms the dirty flag, so it's saved to IndexedDB yet never
    // pushed, and the next server snapshot wipes it ("make a list, it
    // disappears").
    if (state.binders === prev.binders && state.cards === prev.cards && state.lists === prev.lists)
      return;
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
  window.addEventListener('pagehide', handlePageHide);
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
    window.removeEventListener('pagehide', handlePageHide);
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
/**
 * Fetch the server snapshot and reconcile it into local state. Shared by the
 * initial startSync and the refetch-on-focus path so both go through the exact
 * same guards (mutation-during-fetch wins, failed-hydrate safety, guest
 * promotion, keep-local-when-server-lost-collection, blank-push refusal).
 *
 * Callers are responsible for flushing pending local changes (pushNow) BEFORE
 * calling this, so a pull never reverts unsynced local edits.
 */
function buildLocalSnapshot(): LocalSnapshot {
  return {
    collection: buildCollection(),
    binders: buildBinders(),
    decks: buildDecks(),
    games: buildGames(),
  };
}

async function pullAndReconcile(): Promise<void> {
  const mutationCountAtFetchStart = mutationCount;

  let snap: SyncSnapshot | null = null;
  try {
    snap = await fetchSync();
  } catch (err) {
    logger.warn('[sync] fetch failed:', err);
  }
  if (!snap) {
    // No server reply — leave firstPullPending alone so the next attempt
    // (focus pull) still gets the collision-aware branch if the user has
    // local data. The throttle keeps this from spinning.
    return;
  }
  // Reaching this point means we have a fetched snapshot to act on. The
  // flag is consumed BEFORE the branches below so the choice-resolution
  // path (which awaits a user click) can't be re-entered from a focus
  // pull that overlaps the modal.
  const isFirstPull = firstPullPending;
  firstPullPending = false;

  if (mutationCount !== mutationCountAtFetchStart) {
    // The user mutated state during the fetch window. Their intent is
    // fresher than the server's reply — don't overwrite. Just record the
    // server's version so the next push uses the right base. Their push
    // is already queued by the subscriber.
    persistVersion(snap.version);
  } else if (hydrateFailed) {
    // We could not read the local cache, so the in-memory store is empty for
    // the WRONG reason and must not drive reconciliation. If the server has
    // data, trust it (recovers the collection from the source of truth). If
    // the server is also empty, do nothing destructive — the local
    // IndexedDB copy is left intact for a future boot to recover — and
    // surface an error instead of silently wiping. No push happens here:
    // cacheHydrated is false, so pushNow() is already a no-op.
    if (!isServerEmpty(snap)) {
      await applyServerSnapshot(snap);
    } else {
      persistVersion(snap.version);
      useCollectionStore.setState({
        hydrating: false,
        error:
          'Could not read your saved collection on this device. Your data is safe — reload to try again.',
      });
    }
  } else if (isServerEmpty(snap) && hasLocalData()) {
    // Guest promotion path: a newly authed user has local data but the
    // server account is empty. Push local up.
    persistVersion(snap.version);
    setDirty();
    await pushNow();
  } else if (!snap.collection && buildCollection() !== null) {
    // Server has NO collection but still has other slices (binders/decks),
    // so isServerEmpty() is false and the whole-snapshot promotion above
    // doesn't fire. Hydrate succeeded (not hydrateFailed) and we hold a
    // real local collection. Applying the snapshot would blank the
    // in-memory cards even though IndexedDB still has them — the reported
    // "collection loads then wipes after ~2s, binders stay" bug, where the
    // server lost the collection but kept binders. Keep local, take the
    // server's other slices, and push the collection back up to repair the
    // server. This is a server-degraded recovery path, not a merge
    // collision — it MUST run before the collision branch so a user with
    // local cards + server-binders-only doesn't get a useless dialog about
    // a fight that doesn't exist.
    await applyServerSnapshot(snap, { keepLocalCollection: true });
    setDirty();
    await pushNow();
  } else if (isFirstPull && hasLocalData() && !isServerEmpty(snap)) {
    // Collision: this is the first pull for this user on this device AND
    // both sides have data. Historically we silently overwrote local with
    // server (data loss). Now we ask: the registered handler resolves with
    // keep-server (legacy behavior), keep-local (treat as guest promotion),
    // or merge (union by id/copyId).
    const local = buildLocalSnapshot();
    const choice = await invokeCollisionHandler({
      local: countLocal(local),
      server: countServer(snap),
      accountLabel: currentAccountLabel,
    });
    if (choice === 'keep-local') {
      // Server's data is set aside; push the local snapshot up.
      persistVersion(snap.version);
      setDirty();
      await pushNow();
    } else if (choice === 'merge') {
      // Apply the union to the store + IndexedDB, then push so the server
      // reflects the merged state. applyServerSnapshot writes the
      // collection to IndexedDB and persists snap.version, both of which
      // we want here — the merged snapshot reuses the server's version so
      // the next push lands on the right base.
      const merged = mergeSnapshots(local, snap);
      await applyServerSnapshot({
        ...snap,
        collection: merged.collection,
        binders: merged.binders,
        decks: merged.decks,
        games: merged.games,
      });
      setDirty();
      await pushNow();
    } else {
      await applyServerSnapshot(snap);
    }
  } else {
    await applyServerSnapshot(snap);
  }
  // We have an authoritative snapshot (whether we applied it, kept-local
  // around it, merged, or just rebased the version): all branches above
  // leave currentVersion in agreement with the server. Stamp it.
  markSynced();
}

export async function startSync(userId?: string, accountLabel?: string): Promise<void> {
  syncedState = 'syncing';
  emitSynced();
  currentAccountLabel = accountLabel ?? '';

  // Cross-user safety: if persisted state belongs to a different user, wipe
  // before contaminating their account.
  let priorOwner: string | null = null;
  if (userId) {
    try {
      priorOwner = localStorage.getItem(OWNER_KEY);
    } catch {
      /* ignore */
    }
    if (priorOwner && priorOwner !== userId) {
      // A wipe failure must not skip hydrateFromCache below — otherwise the
      // `hydrating` flag never clears and the UI is stuck on a loading state.
      try {
        await wipeLocal();
      } catch (err) {
        logger.warn('[sync] wipeLocal failed during startSync:', err);
      }
    }
    try {
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      /* ignore */
    }
  }
  // The collision dialog should only fire the first time this user's data
  // reaches this device — i.e. when the device had no owner yet (guest
  // signing in for the first time, or a fresh native install signing in).
  // A returning signed-in user, or a user-switch (priorOwner !== userId,
  // which just wiped local), is NOT a collision: there's no merge to ask
  // about because local is empty or already belonged to this user.
  firstPullPending = userId !== undefined && priorOwner === null;

  loadVersion();
  await hydrateFromCache();
  attachSubscribers();

  // Push any unpushed local changes first, so the server reflects the most
  // recent local intent before we apply the fetched snapshot.
  if (isDirty()) {
    await pushNow();
  }

  await pullAndReconcile();

  syncedState = 'ready';
  emitSynced();
}

/**
 * Guest-mode hydration. Loads the locally-cached collection into the store
 * WITHOUT starting sync — guests have no account, so no subscribers attach and
 * nothing is ever pushed; their data lives only in this device's IndexedDB.
 *
 * When a guest later signs in, startSync() re-hydrates, attaches subscribers,
 * and the guest-promotion branch in pullAndReconcile() pushes this local data
 * up to the new (empty) account. Cards live in IndexedDB only, so without this
 * step a guest's collection page would be stuck on its `hydrating` state.
 */
export async function hydrateLocal(): Promise<void> {
  loadVersion();
  await hydrateFromCache();
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
  hydrateFailed = false;
  mutationCount = 0;
  // Fresh sync lifecycle (sign-out / user switch): allow an immediate
  // focus pull and clear any in-flight-pull latch.
  lastPullAt = 0;
  pulling = false;
  // Wipe the visible "Synced Xm ago" stamp too — logout shouldn't leak the
  // previous session's timing into the next account's header.
  lastSyncedAt = null;
  clearDirty();
  for (const key of [VERSION_KEY, OWNER_KEY]) {
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
