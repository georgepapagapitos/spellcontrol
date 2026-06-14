import { App as CapacitorApp } from '@capacitor/app';
import { logger } from '@/lib/logger';
import { setApplyingServer } from './applying-server';
import { isNativePlatform } from './platform';
import { pullSync, pushSync, type SyncRow, type SyncUpsert, type SyncDeletion } from './auth-api';
import * as queue from './mutation-queue';
import * as estore from './entity-store';
import type { EntityKind } from './entity-store';

/**
 * Delta-sync driver.
 *
 * Server is the source of truth for authed users. Local state lives in IDB
 * (`entity-store`) plus a durable mutation queue (`mutation-queue`); the
 * Zustand stores hold a hydrated in-memory view. Every mutation flows:
 *
 *   1. Store mutator updates in-memory state.
 *   2. Mutator calls one of the persistXxxState helpers below.
 *   3. The helper diffs the new in-memory shape against IDB, writes the
 *      changed rows to entity-store, and enqueues per-row upserts/deletes.
 *   4. A debounced push() drains the queue, POSTs to /api/sync, and stamps
 *      the canonical server revs back onto the local rows.
 *
 * Every pull is paged delta `GET /api/sync?since=<cursor>`; tombstones in
 * the response remove the row locally so a deletion on one device shows up
 * on every other device the next time it pulls. No whole-blob PUT, no
 * baseVersion, no 409 — last-write-wins per row.
 */

const CURSOR_KEY = 'spellcontrol-sync-cursor';
const OWNER_KEY = 'spellcontrol-sync-owner';
const BROADCAST_CHANNEL_NAME = 'spellcontrol-sync-v2';
const BROADCAST_STORAGE_KEY = 'spellcontrol-sync-v2-broadcast';

const PUSH_DEBOUNCE_MS = 500;
const FOCUS_PULL_THROTTLE_MS = 3000;

let cursor = 0;
let currentOwnerId: string | null = null;
let isPulling = false;
let isPushing = false;
let pushPending = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFocusPullAt = 0;
let listenersAttached = false;
let broadcastChannel: BroadcastChannel | null = null;
// Capacitor `resume` listener handle (native only). The plugin's addListener is
// async, so we hold the promise and remove the resolved handle on detach.
let resumeListener: ReturnType<typeof CapacitorApp.addListener> | null = null;
/**
 * True while we are writing server-sourced state into the Zustand stores.
 * Store subscribers must check this and skip enqueuing — those changes are
 * already on the server and would loop forever if re-pushed.
 */
let suspendStoreHydration = false;

// The applyingServer flag lives in its own module so subscribers can read it
// synchronously without an import cycle. Re-exported so existing
// `sync.isApplyingServer()` callers keep working.
export { isApplyingServer } from './applying-server';

type SyncState = 'idle' | 'syncing' | 'ready';
let syncedState: SyncState = 'idle';
let lastSyncedAt: number | null = null;
type SyncedListener = () => void;
const syncedListeners = new Set<SyncedListener>();

const sourceId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

// ── Public observability API (preserved from the prior driver) ─────────────

export function onSyncedChange(fn: SyncedListener): () => void {
  syncedListeners.add(fn);
  return () => syncedListeners.delete(fn);
}
export function getSyncState(): SyncState {
  return syncedState;
}
export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

// ── Legibility signals (surfaced in the header SyncIndicator) ────────────────
// Pending = queued local mutations not yet on the server. Online = navigator
// connectivity. syncError = the last push OR pull failed (kept separate so a
// failed push isn't masked by a later successful pull). All three notify via
// the same onSyncedChange listeners so the UI can render honest status.
let pendingCount = 0;
let online = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true;
let pushError = false;
let pullError = false;
let syncError = false;

export function getPendingCount(): number {
  return pendingCount;
}
export function isOnline(): boolean {
  return online;
}
export function hasSyncError(): boolean {
  return syncError;
}

function emit(): void {
  for (const fn of syncedListeners) fn();
}
function markSynced(): void {
  lastSyncedAt = Date.now();
  emit();
}

/** Re-read the durable queue depth; emit only when it changed. */
async function refreshPending(): Promise<void> {
  try {
    const n = await queue.size();
    if (n !== pendingCount) {
      pendingCount = n;
      emit();
    }
  } catch {
    /* ignore — a transient IDB read failure shouldn't crash the UI */
  }
}
function setOnline(v: boolean): void {
  if (v !== online) {
    online = v;
    emit();
  }
}
function recomputeError(): void {
  const v = pushError || pullError;
  if (v !== syncError) {
    syncError = v;
    emit();
  }
}

// ── Cursor + owner persistence ─────────────────────────────────────────────

function loadCursor(): number {
  try {
    const v = localStorage.getItem(CURSOR_KEY);
    const n = v ? Number(v) : 0;
    cursor = Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    cursor = 0;
  }
  return cursor;
}
function saveCursor(v: number): void {
  cursor = v;
  try {
    localStorage.setItem(CURSOR_KEY, String(v));
  } catch {
    /* ignore */
  }
}
function clearCursor(): void {
  cursor = 0;
  try {
    localStorage.removeItem(CURSOR_KEY);
  } catch {
    /* ignore */
  }
}
function loadOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}
function saveOwner(id: string): void {
  try {
    localStorage.setItem(OWNER_KEY, id);
  } catch {
    /* ignore */
  }
}
function clearOwner(): void {
  try {
    localStorage.removeItem(OWNER_KEY);
  } catch {
    /* ignore */
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Guest-mode hydration. Loads the local IDB rows into the in-memory stores
 * without starting sync — guests have no account, so nothing is ever pushed
 * and their data lives only in this device's IDB until they later sign in.
 */
export async function hydrateLocal(): Promise<void> {
  loadCursor();
  await estore.deleteLegacyDatabasesOnce();
  await rehydrateStoresFromIdb();
}

/**
 * Starts the sync lifecycle for a signed-in user. Drains anything queued
 * locally first (e.g. mutations made while offline), then pulls deltas since
 * the saved cursor and applies them. Idempotent — calling it twice for the
 * same user is a no-op-ish (it just re-pulls).
 */
export async function startSync(userId?: string, _accountLabel?: string): Promise<void> {
  syncedState = 'syncing';
  emit();

  if (userId) {
    const prior = loadOwner();
    if (prior && prior !== userId) {
      // Different user is signing in on this device. Wipe local first so we
      // don't contaminate their account with the prior user's mutations.
      await stopSyncAndWipeLocalInternal();
    }
    saveOwner(userId);
    currentOwnerId = userId;
  }

  loadCursor();
  await estore.deleteLegacyDatabasesOnce();
  await rehydrateStoresFromIdb();
  attachLifecycleListeners();
  await refreshPending();

  // Drain any queued local-only mutations first so the server has them
  // before we ask for deltas; then pull whatever the server has newer than
  // our cursor.
  await push();
  await pull();

  syncedState = 'ready';
  emit();
}

/**
 * Stop the sync lifecycle and clear local IDB + queue + cursor. Used on
 * logout and on cross-user sign-in. Resets the in-memory stores to empty.
 */
export async function stopSyncAndWipeLocal(): Promise<void> {
  detachLifecycleListeners();
  await stopSyncAndWipeLocalInternal();
  syncedState = 'idle';
  emit();
}

async function stopSyncAndWipeLocalInternal(): Promise<void> {
  await queue.clear();
  await estore.wipeAll();
  clearCursor();
  clearOwner();
  currentOwnerId = null;
  lastSyncedAt = null;
  pendingCount = 0;
  pushError = false;
  pullError = false;
  syncError = false;
  // Reset in-memory stores. Imported here to avoid a top-level cycle.
  await resetInMemoryStores();
}

/**
 * Best-effort push of any queued mutations. Called by `logout()` before the
 * session cookie is invalidated so a pending deletion is sent first.
 */
export async function flushSync(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await push();
}

/**
 * Explicit user-driven refresh (pull-to-refresh): flush any pending local
 * mutations, then pull server deltas. Awaitable so the UI can keep a spinner up
 * until it settles. Bypasses the focus-pull throttle — this is an intentional
 * gesture, not a passive lifecycle event.
 */
export async function refreshNow(): Promise<void> {
  if (!currentOwnerId) return;
  await push();
  await pull();
}

// ── Mutation entry points (called from stores) ──────────────────────────────

/**
 * Write a single row to local IDB and enqueue a server upsert. Coalesces in
 * the queue if a previous queued op already targets the same row.
 */
export async function recordUpsert(
  kind: EntityKind,
  id: string,
  data: unknown,
  importId?: string
): Promise<void> {
  await estore.putMany(kind, [
    {
      id,
      data,
      rev: 0, // local-only marker; server will assign a real rev on push
      deletedAt: null,
      ...(kind === 'card' ? { importId: importId ?? '' } : {}),
    },
  ]);
  await queue.enqueue({
    op: 'upsert',
    kind,
    id,
    data,
    ...(kind === 'card' ? { importId: importId ?? '' } : {}),
  });
  void refreshPending();
  schedulePush();
}

/**
 * Remove a row from local IDB and enqueue a server deletion. Card and
 * binder/deck/list deletions are independent — deleting an import on the
 * server cascades to its cards, so the client doesn't need to also enqueue
 * card-deletes for cards belonging to a deleted import (the cascade tombstones
 * arrive on the next pull and rehydrateStores drops them locally).
 */
export async function recordDelete(kind: EntityKind, id: string): Promise<void> {
  await estore.deleteMany(kind, [id]);
  await queue.enqueue({ op: 'delete', kind, id });
  void refreshPending();
  schedulePush();
}

/**
 * Diff a kind's full in-memory array against the live rows in IDB, write
 * the delta to IDB, and enqueue upserts/deletes. The replacement for the
 * legacy `saveCollection(buildStored(state))` whole-blob pattern: store
 * mutators still call one of these helpers after every mutation, but per-
 * row sync semantics are computed here instead of after a full PUT.
 *
 * Only persists rows that actually changed since the last synced copy: a row
 * already carrying a server rev (>0) whose data is byte-identical to IDB is
 * skipped. Re-pushing those unchanged rows was the "constantly syncing" smell
 * (E38) — one card edit re-enqueued the entire collection — and it also reset
 * every row's server rev to 0 locally. The diff still computes deletions.
 */
async function persistKind<T>(
  kind: EntityKind,
  rows: T[],
  getId: (row: T) => string,
  getImportId?: (row: T) => string
): Promise<void> {
  const local = await estore.getAllLive(kind);
  const localById = new Map(local.map((r) => [r.id, r]));
  const desiredIds = new Set(rows.map(getId));

  // ponytail: O(kind-size) JSON.stringify per call to detect changes — fine at
  // realistic collection sizes (one diff per user action, no network); hash the
  // rows if a profiler ever flags it. Identical stringify ⟹ identical content,
  // so skipping is never lossy. Unpushed rows (rev 0) are never skipped, so a
  // pending mutation that was dropped pre-ack still gets retried.
  const changedRows: estore.StoredRow[] = [];
  const muts: queue.Mutation[] = [];
  for (const r of rows) {
    const id = getId(r);
    const existing = localById.get(id);
    const unchanged =
      existing != null &&
      existing.rev > 0 &&
      existing.deletedAt == null &&
      JSON.stringify(existing.data) === JSON.stringify(r);
    if (unchanged) continue;
    changedRows.push({
      id,
      data: r,
      rev: 0,
      deletedAt: null,
      ...(kind === 'card' && getImportId ? { importId: getImportId(r) } : {}),
    });
    muts.push({
      op: 'upsert',
      kind,
      id,
      data: r,
      ...(kind === 'card' && getImportId ? { importId: getImportId(r) } : {}),
    });
  }
  if (changedRows.length > 0) await estore.putMany(kind, changedRows);

  const toDelete: string[] = [];
  for (const id of localById.keys()) if (!desiredIds.has(id)) toDelete.push(id);
  if (toDelete.length > 0) await estore.deleteMany(kind, toDelete);
  for (const id of toDelete) muts.push({ op: 'delete', kind, id });

  if (muts.length > 0) {
    await queue.enqueueBatch(muts);
    void refreshPending();
    schedulePush();
  }
}

export const persistCardsState = (
  cards: ReadonlyArray<{ copyId: string; importId?: string }>
): Promise<void> =>
  persistKind(
    'card',
    cards as Array<{ copyId: string; importId?: string }>,
    (c) => c.copyId,
    (c) => c.importId ?? ''
  );

export const persistImportsState = (imports: ReadonlyArray<{ id: string }>): Promise<void> =>
  persistKind('import', imports as Array<{ id: string }>, (i) => i.id);

export const persistBindersState = (binders: ReadonlyArray<{ id: string }>): Promise<void> =>
  persistKind('binder', binders as Array<{ id: string }>, (b) => b.id);

export const persistListsState = (lists: ReadonlyArray<{ id: string }>): Promise<void> =>
  persistKind('list', lists as Array<{ id: string }>, (l) => l.id);

export const persistDecksState = (decks: ReadonlyArray<{ id: string }>): Promise<void> =>
  persistKind('deck', decks as Array<{ id: string }>, (d) => d.id);

export const persistGamesState = (games: ReadonlyArray<{ id: string }>): Promise<void> =>
  persistKind('game', games as Array<{ id: string }>, (g) => g.id);

// ── Pull / push ─────────────────────────────────────────────────────────────

async function pull(): Promise<void> {
  if (isPulling || !currentOwnerId) return;
  isPulling = true;
  // A cursor of 0 means we have no local rows yet (cursor + IDB are wiped
  // together), so there's nothing to delete — tell the server to skip every
  // historical tombstone and send only live rows. Captured once: it applies to
  // every page of this bootstrap pull even as the cursor advances.
  const fresh = cursor === 0;
  try {
    while (true) {
      const page = await pullSync(cursor, undefined, fresh);
      if (page.rows.length > 0) {
        await applyServerRows(page.rows);
        saveCursor(page.cursor);
        markSynced();
      }
      if (!page.hasMore) break;
    }
    broadcastCursor();
    pullError = false;
    recomputeError();
  } catch (err) {
    logger.warn('[sync] pull failed:', err);
    pullError = true;
    recomputeError();
  } finally {
    isPulling = false;
  }
}

async function push(): Promise<void> {
  if (isPushing || !currentOwnerId) {
    if (isPushing) pushPending = true;
    return;
  }
  isPushing = true;
  // Highest rev the server reports while draining. Used only as a cross-tab
  // broadcast hint — never adopted as our own pull cursor (see below).
  let serverRevHint = cursor;
  try {
    while (true) {
      const batch = await queue.peekBatch(500);
      if (batch.length === 0) break;

      const upserts: SyncUpsert[] = [];
      const deletions: SyncDeletion[] = [];
      for (const { m } of batch) {
        if (m.op === 'upsert') {
          upserts.push({
            kind: m.kind,
            id: m.id,
            data: m.data,
            ...(m.kind === 'card' && m.importId !== undefined ? { importId: m.importId } : {}),
          });
        } else {
          deletions.push({ kind: m.kind, id: m.id });
        }
      }

      const result = await pushSync({ upserts, deletions });

      // Stamp the canonical server revs onto local rows. For upserts, the
      // local row exists in IDB with rev=0 — replace its rev so a subsequent
      // pull doesn't re-deliver it. For deletions / cascades, the local row
      // is already gone (the mutator removed it) so there's nothing to update.
      const byKind: Record<string, estore.StoredRow[]> = {};
      for (const a of result.applied) {
        if (a.deletedAt != null) continue;
        const existing = await estore.getById(a.kind, a.id);
        if (existing) {
          (byKind[a.kind] ??= []).push({ ...existing, rev: a.rev });
        }
      }
      for (const [kind, rows] of Object.entries(byKind)) {
        await estore.putMany(kind as EntityKind, rows);
      }

      await queue.ack(batch.map((b) => b.seq));
      void refreshPending();
      // NEVER do `saveCursor(result.cursor)` here. The POST response's cursor is
      // the server's global max rev *after our writes* — adopting it as our pull
      // cursor would skip any lower-rev rows other devices wrote that we haven't
      // pulled yet, silently dropping them from this device (the bug that
      // stranded a deleted collection mid-converge). The cursor may only advance
      // via pull(), which applies every row in rev order. Our own just-pushed
      // rows are stamped into IDB above, so the next pull re-delivering them is a
      // cheap idempotent no-op.
      if (result.cursor > serverRevHint) serverRevHint = result.cursor;
      markSynced();
    }
    // Nudge peer tabs to pull (we wrote new revs), but pass the server hint
    // explicitly rather than our own cursor — our cursor intentionally lags.
    broadcastCursor(serverRevHint);
    pushError = false;
    recomputeError();
    if (pushPending) {
      pushPending = false;
      schedulePush();
    }
  } catch (err) {
    logger.warn('[sync] push failed:', err);
    // Leave the queue intact — retry on next mutation, focus, or online.
    pushError = true;
    recomputeError();
  } finally {
    isPushing = false;
  }
}

function schedulePush(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void push();
  }, PUSH_DEBOUNCE_MS);
}

// ── Apply server deltas → local IDB + in-memory stores ─────────────────────

async function applyServerRows(rows: SyncRow[]): Promise<void> {
  // Batch by kind so we can write all upserts / all deletes in one IDB tx per kind.
  const upsertsByKind = new Map<EntityKind, estore.StoredRow[]>();
  const deletionsByKind = new Map<EntityKind, { id: string; rev: number; deletedAt: number }[]>();
  for (const r of rows) {
    if (r.deletedAt != null) {
      const arr = deletionsByKind.get(r.kind) ?? [];
      arr.push({ id: r.id, rev: r.rev, deletedAt: r.deletedAt });
      deletionsByKind.set(r.kind, arr);
    } else {
      const arr = upsertsByKind.get(r.kind) ?? [];
      arr.push({
        id: r.id,
        data: r.data,
        rev: r.rev,
        deletedAt: null,
        ...(r.kind === 'card' ? { importId: r.importId ?? '' } : {}),
      });
      upsertsByKind.set(r.kind, arr);
    }
  }
  for (const [kind, rows] of upsertsByKind) await estore.putMany(kind, rows);
  // Write a tombstone row (data: null, deletedAt set) rather than hard-removing
  // the key, so a re-delivered tombstone on a lagging cursor stays deleted
  // instead of resurrecting as a live row. getAllLive filters these out.
  // Batched (one tx per kind) — a delta carrying thousands of tombstones must
  // not open thousands of IDB transactions.
  for (const [kind, dels] of deletionsByKind) await estore.putTombstones(kind, dels);

  // A deck row changed on the server (another device edited it) → this device's
  // undo/redo snapshots for that deck are now stale; replaying them would clobber
  // the remote edit (LWW). Drop those stacks. Dynamic import avoids a load-order
  // cycle (deck-history → decks store → sync). Only runs when a delta actually
  // delivered deck rows, so idle focus-pulls don't nuke history.
  const changedDeckIds = new Set<string>([
    ...(upsertsByKind.get('deck')?.map((r) => r.id) ?? []),
    ...(deletionsByKind.get('deck')?.map((d) => d.id) ?? []),
  ]);
  if (changedDeckIds.size > 0) {
    try {
      const { deckHistory } = await import('../store/deck-history');
      deckHistory.invalidate(changedDeckIds);
    } catch {
      /* history is a UX nicety; never let it break sync */
    }
  }

  if (!suspendStoreHydration) {
    await rehydrateStoresFromIdb();
  }
}

/**
 * Suspend rehydrateStoresFromIdb() while a caller is doing many sync calls in
 * a row (e.g. a batch import that calls persistKind() N times). Without this
 * we'd rehydrate the in-memory stores after every persist; with it we wait
 * for the caller to drop the suspension and rehydrate once.
 *
 * Exposed (but currently unused) so a future bulk-import path can opt in.
 */
export function withSuspendedHydration<T>(fn: () => Promise<T>): Promise<T> {
  suspendStoreHydration = true;
  return fn().finally(() => {
    suspendStoreHydration = false;
  });
}

// ── Cross-tab + lifecycle listeners ────────────────────────────────────────

function attachLifecycleListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;
  if (typeof window === 'undefined') return;

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof BroadcastChannel !== 'undefined') {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.addEventListener('message', onBroadcast);
  } else {
    window.addEventListener('storage', onStorageBroadcast);
  }

  // Native: DOM focus/visibilitychange are unreliable in the Capacitor WebView,
  // so a change made on another device wouldn't show until the app was killed
  // and relaunched. The Capacitor `resume` event is the reliable "app
  // foregrounded" signal — pull on it (throttled via onFocus) so returning to
  // the app refreshes. onFocus's throttle also de-dupes if visibilitychange
  // does fire alongside it.
  if (isNativePlatform()) {
    resumeListener = CapacitorApp.addListener('resume', onFocus);
  }
}

function detachLifecycleListeners(): void {
  if (!listenersAttached) return;
  listenersAttached = false;
  if (typeof window === 'undefined') return;
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
  window.removeEventListener('focus', onFocus);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (broadcastChannel) {
    broadcastChannel.removeEventListener('message', onBroadcast);
    broadcastChannel.close();
    broadcastChannel = null;
  } else {
    window.removeEventListener('storage', onStorageBroadcast);
  }
  if (resumeListener) {
    void resumeListener.then((h) => h.remove());
    resumeListener = null;
  }
}

function onOnline(): void {
  setOnline(true);
  void push();
  void pull();
}
function onOffline(): void {
  setOnline(false);
}
function onFocus(): void {
  const now = Date.now();
  if (now - lastFocusPullAt < FOCUS_PULL_THROTTLE_MS) return;
  lastFocusPullAt = now;
  void pull();
}
function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') onFocus();
}

interface SyncBroadcast {
  type: 'sync-applied';
  userId: string;
  cursor: number;
  sourceId: string;
}

function broadcastCursor(hint: number = cursor): void {
  if (!currentOwnerId) return;
  const msg: SyncBroadcast = {
    type: 'sync-applied',
    userId: currentOwnerId,
    cursor: hint,
    sourceId,
  };
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(msg);
    } catch {
      /* ignore */
    }
  } else if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(BROADCAST_STORAGE_KEY, `${Date.now()}:${JSON.stringify(msg)}`);
    } catch {
      /* ignore */
    }
  }
}

function onBroadcast(ev: MessageEvent): void {
  const msg = ev.data as SyncBroadcast | undefined;
  if (!msg || msg.type !== 'sync-applied') return;
  if (msg.sourceId === sourceId) return;
  if (msg.userId !== currentOwnerId) return;
  if (msg.cursor <= cursor) return;
  void pull();
}

function onStorageBroadcast(ev: StorageEvent): void {
  if (ev.key !== BROADCAST_STORAGE_KEY || !ev.newValue) return;
  const idx = ev.newValue.indexOf(':');
  if (idx < 0) return;
  try {
    const msg = JSON.parse(ev.newValue.slice(idx + 1)) as SyncBroadcast;
    if (msg.type !== 'sync-applied') return;
    if (msg.sourceId === sourceId) return;
    if (msg.userId !== currentOwnerId) return;
    if (msg.cursor <= cursor) return;
    void pull();
  } catch {
    /* ignore */
  }
}

// ── Store hydration (loads IDB rows into Zustand state) ────────────────────

/**
 * Read every live row from IDB and set it onto the appropriate Zustand store.
 * Late-imports the stores to break a circular dependency (stores import this
 * module for the persist helpers).
 */
async function rehydrateStoresFromIdb(): Promise<void> {
  const [cards, imports, lists, binders, decks, games] = await Promise.all([
    estore.getAllLive('card'),
    estore.getAllLive('import'),
    estore.getAllLive('list'),
    estore.getAllLive('binder'),
    estore.getAllLive('deck'),
    estore.getAllLive('game'),
  ]);

  type AnyRecord = Record<string, unknown>;
  const cardData = cards
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');
  const importData = imports
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');
  const listData = lists
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');
  const binderData = binders
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');
  const deckData = decks
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');
  const gameData = games
    .map((r) => r.data)
    .filter((d): d is AnyRecord => d != null && typeof d === 'object');

  const { useCollectionStore } = await import('../store/collection');
  const { useDecksStore } = await import('../store/decks');
  const { usePlayStore } = await import('../store/play');

  setApplyingServer(true);
  try {
    // Casts: rows are stored with a typed shape on write (see persistKind),
    // but the read path passes through `unknown` for IDB hygiene. The state
    // setters take a partial of their state shape, so a `Parameters<…>[0]`
    // structural cast lets us hand off the concrete arrays without giving
    // them their original element type back here.
    useCollectionStore.setState({
      cards: cardData,
      importHistory: importData,
      lists: listData,
      binders: binderData,
      hydrating: false,
    } as unknown as Parameters<typeof useCollectionStore.setState>[0]);
    useDecksStore.setState({ decks: deckData, hydrated: true } as unknown as Parameters<
      typeof useDecksStore.setState
    >[0]);
    usePlayStore.setState({ history: gameData, hydrated: true } as unknown as Parameters<
      typeof usePlayStore.setState
    >[0]);
  } finally {
    setApplyingServer(false);
  }
}

async function resetInMemoryStores(): Promise<void> {
  const { useCollectionStore } = await import('../store/collection');
  const { useDecksStore } = await import('../store/decks');
  const { usePlayStore } = await import('../store/play');
  const { deckHistory } = await import('../store/deck-history');
  deckHistory.clear();
  setApplyingServer(true);
  try {
    useCollectionStore.setState({
      cards: [],
      importHistory: [],
      lists: [],
      binders: [],
      fileName: '',
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: null,
      hydrating: false,
    } as unknown as Parameters<typeof useCollectionStore.setState>[0]);
    useDecksStore.setState({ decks: [], hydrated: true } as unknown as Parameters<
      typeof useDecksStore.setState
    >[0]);
    usePlayStore.setState({ history: [], hydrated: true } as unknown as Parameters<
      typeof usePlayStore.setState
    >[0]);
  } finally {
    setApplyingServer(false);
  }
}
