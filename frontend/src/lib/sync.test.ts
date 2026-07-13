// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock the network layer — tests drive the driver with fixture pull pages
// and assert on the push payloads it builds.
vi.mock('./auth-api', () => ({
  pullSync: vi.fn(),
  pushSync: vi.fn(),
}));

// Default to web; the native-resume test flips isNativePlatform to true.
vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => false) }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));

import {
  startSync,
  stopSyncAndWipeLocal,
  hydrateLocal,
  flushSync,
  isApplyingServer,
  getSyncState,
  getLastSyncedAt,
  onSyncedChange,
  persistBindersState,
  persistCardsState,
  persistDecksState,
  persistGamesState,
  persistImportsState,
  persistListsState,
  recordUpsert,
  refreshNow,
  getPendingCount,
  isOnline,
  hasSyncError,
} from './sync';
import { pullSync, pushSync } from './auth-api';
import { isNativePlatform } from './platform';
import { App as CapacitorApp } from '@capacitor/app';
import * as estore from './entity-store';
import * as queue from './mutation-queue';
import * as cardPrices from './card-prices';

const mockPull = pullSync as unknown as ReturnType<typeof vi.fn>;
const mockPush = pushSync as unknown as ReturnType<typeof vi.fn>;
const mockIsNative = isNativePlatform as unknown as ReturnType<typeof vi.fn>;
const mockAddListener = CapacitorApp.addListener as unknown as ReturnType<typeof vi.fn>;

async function waitForLifecycleSyncToSettle(): Promise<void> {
  await vi.waitFor(async () => {
    const before = mockPull.mock.calls.length;
    await refreshNow();
    expect(mockPull.mock.calls.length).toBeGreaterThan(before);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  estore._resetDbPromiseForTests();
  queue._resetDbPromiseForTests();
  cardPrices._resetForTests();
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
  // Default: empty pull, empty push.
  mockPull.mockResolvedValue({ rows: [], cursor: 0, hasMore: false });
  mockPush.mockResolvedValue({ applied: [], cursor: 0 });
  mockIsNative.mockReturnValue(false); // web by default; native test opts in
});

afterEach(async () => {
  await stopSyncAndWipeLocal();
});

describe('lifecycle', () => {
  it('starts in `idle`, transitions through `syncing` → `ready` during startSync', async () => {
    expect(getSyncState()).toBe('idle');
    const states: string[] = [];
    const unsub = onSyncedChange(() => states.push(getSyncState()));
    await startSync('user-1');
    unsub();
    expect(getSyncState()).toBe('ready');
    expect(states).toContain('syncing');
    expect(states[states.length - 1]).toBe('ready');
  });

  it('records lastSyncedAt after a non-empty pull', async () => {
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }],
      cursor: 1,
      hasMore: false,
    });
    expect(getLastSyncedAt()).toBeNull();
    await startSync('user-1');
    expect(getLastSyncedAt()).toBeGreaterThan(0);
  });

  it('persists the cursor across startSync calls', async () => {
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' }, rev: 42, deletedAt: null }],
      cursor: 42,
      hasMore: false,
    });
    await startSync('user-1');
    expect(localStorage.getItem('spellcontrol-sync-cursor')).toBe('42');
    // A second startSync uses since=42 — no rows above that.
    mockPull.mockResolvedValueOnce({ rows: [], cursor: 42, hasMore: false });
    await startSync('user-1');
    // A non-zero cursor is not a fresh pull → server still sends tombstones.
    expect(mockPull).toHaveBeenLastCalledWith(42, undefined, false);
  });

  it('wipes local state when a different user signs in on the same device', async () => {
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }],
      cursor: 1,
      hasMore: false,
    });
    await startSync('user-1');
    expect((await estore.getAllLive('binder')).map((r) => r.id)).toEqual(['b-1']);
    mockPull.mockResolvedValueOnce({ rows: [], cursor: 0, hasMore: false });
    await startSync('user-2');
    expect(await estore.getAllLive('binder')).toEqual([]);
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBe('user-2');
  });

  it('stopSyncAndWipeLocal clears the queue, entity-store, cursor, and owner', async () => {
    await startSync('user-1');
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await estore.putMany('binder', [{ id: 'b-1', data: {}, rev: 0, deletedAt: null }]);
    await stopSyncAndWipeLocal();
    expect(await queue.size()).toBe(0);
    expect(await estore.getAllLive('binder')).toEqual([]);
    expect(localStorage.getItem('spellcontrol-sync-cursor')).toBeNull();
    expect(localStorage.getItem('spellcontrol-sync-owner')).toBeNull();
    expect(getSyncState()).toBe('idle');
  });

  it('hydrateLocal loads IDB rows without starting sync', async () => {
    await estore.putMany('binder', [
      { id: 'b-pre', data: { id: 'b-pre' }, rev: 5, deletedAt: null },
    ]);
    await hydrateLocal();
    // Still 'idle' — no startSync was called.
    expect(getSyncState()).toBe('idle');
    expect(mockPull).not.toHaveBeenCalled();
  });
});

describe('native resume', () => {
  it('pulls when the app is foregrounded (Capacitor resume)', async () => {
    mockIsNative.mockReturnValue(true);
    await startSync('user-1');
    // Grab the handler registered for the Capacitor `resume` event.
    const resumeCall = mockAddListener.mock.calls.find((c) => c[0] === 'resume');
    expect(resumeCall).toBeDefined();
    const onResume = resumeCall![1] as () => void;

    const before = mockPull.mock.calls.length;
    onResume(); // simulate the app coming back to the foreground
    await vi.waitFor(() => expect(mockPull.mock.calls.length).toBe(before + 1));
    await waitForLifecycleSyncToSettle();
  });

  it('does not register a resume listener on web', async () => {
    mockIsNative.mockReturnValue(false);
    await startSync('user-1');
    expect(mockAddListener.mock.calls.some((c) => c[0] === 'resume')).toBe(false);
  });
});

describe('refreshNow', () => {
  it('flushes pending mutations then pulls', async () => {
    mockIsNative.mockReturnValue(true); // durable queue is native-only
    await startSync('user-1');
    await recordUpsert('binder', 'b-ref', { id: 'b-ref' }); // queue something to flush
    mockPush.mockClear();
    mockPull.mockClear();
    await refreshNow();
    expect(mockPush).toHaveBeenCalled(); // the pending mutation was pushed
    expect(mockPull).toHaveBeenCalled();
  });

  it('is a no-op with no signed-in owner', async () => {
    await refreshNow(); // never started sync
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockPull).not.toHaveBeenCalled();
  });
});

describe('pull', () => {
  it('applies upsert rows to entity-store', async () => {
    mockPull.mockResolvedValueOnce({
      rows: [
        { kind: 'binder', id: 'b-1', data: { id: 'b-1', name: 'A' }, rev: 1, deletedAt: null },
        {
          kind: 'card',
          id: 'c-1',
          data: { copyId: 'c-1' },
          rev: 2,
          deletedAt: null,
          importId: 'imp-1',
        },
      ],
      cursor: 2,
      hasMore: false,
    });
    await startSync('user-1');
    const binders = await estore.getAllLive('binder');
    const cards = await estore.getAllLive('card');
    expect(binders.map((r) => r.id)).toEqual(['b-1']);
    expect(cards.map((r) => r.id)).toEqual(['c-1']);
    expect(cards[0].importId).toBe('imp-1');
  });

  it('applies tombstone rows by removing the local row', async () => {
    // Seed a live row in IDB.
    await estore.putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }]);
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-1', data: null, rev: 5, deletedAt: 1700000000000 }],
      cursor: 5,
      hasMore: false,
    });
    await startSync('user-1');
    expect(await estore.getAllLive('binder')).toEqual([]);
  });

  it('retains a tombstone row (carrying server rev) instead of hard-deleting it', async () => {
    // Resurrection guard: a pulled tombstone must leave a deletedAt-marked row
    // behind so a re-delivered tombstone on a lagging cursor stays dead rather
    // than reappearing as a live row.
    await estore.putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }]);
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-1', data: null, rev: 5, deletedAt: 1700000000000 }],
      cursor: 5,
      hasMore: false,
    });
    await startSync('user-1');
    const raw = await estore.getById('binder', 'b-1');
    expect(raw).toMatchObject({ id: 'b-1', data: null, rev: 5, deletedAt: 1700000000000 });
    expect(await estore.getAllLive('binder')).toEqual([]);
  });

  it('keeps pulling while hasMore is true and advances the cursor', async () => {
    mockPull
      .mockResolvedValueOnce({
        rows: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }],
        cursor: 1,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        rows: [{ kind: 'binder', id: 'b-2', data: { id: 'b-2' }, rev: 2, deletedAt: null }],
        cursor: 2,
        hasMore: false,
      });
    await startSync('user-1');
    expect(mockPull).toHaveBeenCalledTimes(2);
    // Bootstrap pull starts at cursor 0 → fresh=true, held across every page.
    expect(mockPull).toHaveBeenNthCalledWith(1, 0, undefined, true);
    expect(mockPull).toHaveBeenNthCalledWith(2, 1, undefined, true);
    expect((await estore.getAllLive('binder')).map((r) => r.id).sort()).toEqual(['b-1', 'b-2']);
  });

  it("doesn't crash when the network throws", async () => {
    mockPull.mockRejectedValueOnce(new Error('offline'));
    await expect(startSync('user-1')).resolves.toBeUndefined();
    expect(getSyncState()).toBe('ready');
  });

  it('rehydrates the in-memory stores ONCE for a multi-page bootstrap pull', async () => {
    // Regression guard for the native boot OOM: applyServerRows used to call
    // rehydrateStoresFromIdb on EVERY page, so a 3-page bootstrap rebuilt +
    // re-materialized the whole collection 3 times (6× for ~12k cards). The
    // fix suspends rehydration across the pull and rehydrates once at the end.
    const { useCollectionStore } = await import('../store/collection');
    const card = (id: string, rev: number) => ({
      kind: 'card' as const,
      id,
      data: { copyId: id, name: id },
      rev,
      deletedAt: null,
      importId: '',
    });
    mockPull
      .mockResolvedValueOnce({ rows: [card('c1', 1), card('c2', 2)], cursor: 2, hasMore: true })
      .mockResolvedValueOnce({ rows: [card('c3', 3), card('c4', 4)], cursor: 4, hasMore: true })
      .mockResolvedValueOnce({ rows: [card('c5', 5)], cursor: 5, hasMore: false });

    const setStateSpy = vi.spyOn(useCollectionStore, 'setState');
    await startSync('user-1');

    // rehydrateStoresFromIdb is the only thing that setStates the collection
    // with a `cards` payload. Count those: one cold-cache rehydrate at startup
    // (empty IDB) + exactly ONE after the entire 3-page pull — NOT one per page.
    const rehydrations = setStateSpy.mock.calls.filter(
      (c) => c[0] != null && typeof c[0] === 'object' && 'cards' in (c[0] as object)
    ).length;
    expect(rehydrations).toBe(2);
    // All five cards from all three pages landed in the in-memory store.
    expect(useCollectionStore.getState().cards).toHaveLength(5);
  });
});

describe('push', () => {
  it('drains the queue and stamps server revs onto local rows', async () => {
    await estore.putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 0, deletedAt: null }]);
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 99, deletedAt: null }],
      cursor: 99,
    });
    await startSync('user-1');
    expect(mockPush).toHaveBeenCalledWith({
      upserts: [{ kind: 'binder', id: 'b-1', data: { id: 'b-1' } }],
      deletions: [],
    });
    expect(await queue.size()).toBe(0);
    const row = await estore.getById('binder', 'b-1');
    expect(row?.rev).toBe(99);
    // The push stamps the server rev onto the local row but must NOT advance the
    // pull cursor — only pull() does that. Here the follow-up pull returns empty,
    // so the cursor is never written.
    expect(localStorage.getItem('spellcontrol-sync-cursor')).toBeNull();
  });

  it('never advances the cursor from a push — only from rows it actually pulls', async () => {
    // Regression for the cursor-skip divergence bug: a device that pushes while
    // behind on pulls must not jump its cursor to the push response's global-max
    // rev, or it silently skips lower-rev rows other devices wrote.
    //
    // Local has a row another device is about to tombstone at rev 500. We push
    // our own unrelated mutation; the server acks it and reports a global cursor
    // of 1000 (other devices wrote up to there). The pull that follows — from our
    // real cursor (0), since push must not advance it — must still deliver and
    // apply the rev-500 tombstone, and the cursor must reflect what we pulled
    // (500), never the push's 1000.
    await estore.putMany('binder', [
      { id: 'b-other', data: { id: 'b-other' }, rev: 10, deletedAt: null },
    ]);
    await queue.enqueue({ op: 'delete', kind: 'binder', id: 'b-mine' });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-mine', rev: 1000, deletedAt: 1 }],
      cursor: 1000,
    });
    mockPull.mockResolvedValueOnce({
      rows: [{ kind: 'binder', id: 'b-other', data: null, rev: 500, deletedAt: 1700000000000 }],
      cursor: 500,
      hasMore: false,
    });
    await startSync('user-1');
    // The other device's tombstone was applied, not skipped.
    expect(await estore.getAllLive('binder')).toEqual([]);
    // Cursor tracks the pulled rev, never the push's global max.
    expect(localStorage.getItem('spellcontrol-sync-cursor')).toBe('500');
  });

  it('forwards upserts and deletions separately', async () => {
    await queue.enqueueBatch([
      { op: 'upsert', kind: 'deck', id: 'd-1', data: { id: 'd-1' } },
      { op: 'delete', kind: 'binder', id: 'b-1' },
      {
        op: 'upsert',
        kind: 'card',
        id: 'c-1',
        data: { copyId: 'c-1' },
        importId: 'imp-1',
      },
    ]);
    mockPush.mockResolvedValueOnce({
      applied: [
        { kind: 'deck', id: 'd-1', rev: 1, deletedAt: null },
        { kind: 'binder', id: 'b-1', rev: 2, deletedAt: 1 },
        { kind: 'card', id: 'c-1', rev: 3, deletedAt: null },
      ],
      cursor: 3,
    });
    await startSync('user-1');
    const arg = mockPush.mock.calls[0][0] as {
      upserts: Array<{ kind: string; id: string }>;
      deletions: Array<{ kind: string; id: string }>;
    };
    expect(arg.upserts.map((u) => `${u.kind}:${u.id}`).sort()).toEqual(['card:c-1', 'deck:d-1']);
    expect(arg.deletions.map((d) => `${d.kind}:${d.id}`)).toEqual(['binder:b-1']);
  });

  it('sends a deck clientRev re-derived from the live IDB syncedRev', async () => {
    // The clientRev is the row's current syncedRev at SEND time, not the value
    // baked into the queued mutation — so a same-device edit chained off our own
    // prior push uses the rev that push produced, never a stale base.
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', name: 'changed' }, rev: 0, syncedRev: 12, deletedAt: null },
    ]);
    await queue.enqueue({
      op: 'upsert',
      kind: 'deck',
      id: 'd-1',
      data: { id: 'd-1', name: 'changed' },
      clientRev: 12,
    });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'deck', id: 'd-1', rev: 13, deletedAt: null }],
      cursor: 13,
    });
    await startSync('user-1');
    expect(mockPush).toHaveBeenCalledWith({
      upserts: [{ kind: 'deck', id: 'd-1', data: { id: 'd-1', name: 'changed' }, clientRev: 12 }],
      deletions: [],
    });
  });

  it('re-derives the deck clientRev from the stamped syncedRev across separate pushes (no self-conflict)', async () => {
    // Single-device regression: a second deck edit, enqueued before the first
    // push's ack stamped the new syncedRev, has a STALE baked clientRev. At send
    // time the driver must use the freshly-stamped syncedRev instead, or the
    // server reject-stales our own write as a phantom "another device" conflict.
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', n: 1 }, rev: 0, syncedRev: 100, deletedAt: null },
    ]);
    await queue.enqueue({
      op: 'upsert',
      kind: 'deck',
      id: 'd-1',
      data: { id: 'd-1', n: 1 },
      clientRev: 100,
    });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'deck', id: 'd-1', rev: 106, deletedAt: null }],
      cursor: 106,
    });
    await startSync('user-1'); // drains edit 1 → ack stamps syncedRev 106

    // Edit 2 lands in the queue still carrying the now-stale baked clientRev 100.
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', n: 2 }, rev: 0, syncedRev: 106, deletedAt: null },
    ]);
    await queue.enqueue({
      op: 'upsert',
      kind: 'deck',
      id: 'd-1',
      data: { id: 'd-1', n: 2 },
      clientRev: 100,
    });
    mockPush.mockClear();
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'deck', id: 'd-1', rev: 107, deletedAt: null }],
      cursor: 107,
    });
    await flushSync();
    const body = mockPush.mock.calls[0][0] as {
      upserts: Array<{ id: string; clientRev?: number }>;
    };
    expect(body.upserts[0].clientRev).toBe(106); // re-derived, NOT the baked stale 100
  });

  it('adopts server-winning decks and acks stale deck conflicts', async () => {
    await estore.putMany('deck', [
      {
        id: 'd-1',
        data: { id: 'd-1', name: 'mine' },
        rev: 0,
        syncedRev: 5,
        deletedAt: null,
      },
    ]);
    await queue.enqueue({
      op: 'upsert',
      kind: 'deck',
      id: 'd-1',
      data: { id: 'd-1', name: 'mine' },
      clientRev: 5,
    });
    mockPush.mockResolvedValueOnce({
      applied: [],
      conflicts: [
        { kind: 'deck', id: 'd-1', serverRev: 6, serverData: { id: 'd-1', name: 'server' } },
      ],
      cursor: 0,
    });
    await startSync('user-1');
    expect(await queue.size()).toBe(0);
    const row = await estore.getById('deck', 'd-1');
    expect(row).toMatchObject({
      data: { id: 'd-1', name: 'server' },
      rev: 6,
      syncedRev: 6,
      deletedAt: null,
    });
  });

  it('keeps the queue intact when the network throws', async () => {
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    mockPush.mockRejectedValueOnce(new Error('offline'));
    await startSync('user-1');
    expect(await queue.size()).toBe(1);
  });

  it('flushSync forces a queue drain immediately', async () => {
    await startSync('user-1');
    mockPush.mockClear();
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 5, deletedAt: null }],
      cursor: 5,
    });
    await flushSync();
    expect(mockPush).toHaveBeenCalled();
  });
});

describe('persistKind helpers', () => {
  // The durable mutation queue is native-only; web write-through is covered in
  // its own describe below.
  beforeEach(() => mockIsNative.mockReturnValue(true));

  it('persistBindersState writes upserts for each row and tombstones the missing ones', async () => {
    await estore.putMany('binder', [
      { id: 'b-1', data: { id: 'b-1', name: 'old' }, rev: 1, deletedAt: null },
      { id: 'b-2', data: { id: 'b-2', name: 'old' }, rev: 2, deletedAt: null },
    ]);
    await persistBindersState([{ id: 'b-1', name: 'new' } as { id: string }]);
    // b-1 was upserted, b-2 should be gone (deleted locally) and enqueued for server delete.
    const live = await estore.getAllLive('binder');
    expect(live.map((r) => r.id)).toEqual(['b-1']);
    const batch = await queue.peekBatch(10);
    const ops = batch.map((b) => `${b.m.op}:${b.m.kind}:${b.m.id}`);
    expect(ops).toContain('upsert:binder:b-1');
    expect(ops).toContain('delete:binder:b-2');
  });

  it('skips rows that are unchanged since the last synced copy (E38)', async () => {
    // b-1 already carries a server rev and identical data → must not re-enqueue.
    // b-2 differs → must enqueue. This is the chattiness fix: a one-binder edit
    // no longer re-pushes the whole kind.
    await estore.putMany('binder', [
      { id: 'b-1', data: { id: 'b-1', name: 'same' }, rev: 7, deletedAt: null },
      { id: 'b-2', data: { id: 'b-2', name: 'old' }, rev: 8, deletedAt: null },
    ]);
    await persistBindersState([
      { id: 'b-1', name: 'same' } as { id: string },
      { id: 'b-2', name: 'changed' } as { id: string },
    ]);
    const ops = (await queue.peekBatch(10)).map((b) => `${b.m.op}:${b.m.id}`);
    expect(ops).toEqual(['upsert:b-2']);
    // The unchanged row keeps its server rev (not reset to 0).
    expect((await estore.getById('binder', 'b-1'))?.rev).toBe(7);
  });

  it('still re-enqueues an unchanged row that was never pushed (rev 0)', async () => {
    await estore.putMany('binder', [
      { id: 'b-1', data: { id: 'b-1', name: 'same' }, rev: 0, deletedAt: null },
    ]);
    await persistBindersState([{ id: 'b-1', name: 'same' } as { id: string }]);
    const ops = (await queue.peekBatch(10)).map((b) => `${b.m.op}:${b.m.id}`);
    expect(ops).toEqual(['upsert:b-1']);
  });

  it('captures a deck base rev before resetting the local row to rev 0', async () => {
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', name: 'old' }, rev: 11, deletedAt: null },
    ]);
    await persistDecksState([{ id: 'd-1', name: 'changed' } as { id: string }]);
    const row = await estore.getById('deck', 'd-1');
    expect(row).toMatchObject({ rev: 0, syncedRev: 11 });
    const batch = await queue.peekBatch(10);
    expect(batch[0].m).toMatchObject({
      op: 'upsert',
      kind: 'deck',
      id: 'd-1',
      clientRev: 11,
    });
  });

  it('preserves the original deck base rev across repeated local edits before push', async () => {
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', name: 'old' }, rev: 11, deletedAt: null },
    ]);
    await persistDecksState([{ id: 'd-1', name: 'changed once' } as { id: string }]);
    await persistDecksState([{ id: 'd-1', name: 'changed twice' } as { id: string }]);
    const row = await estore.getById('deck', 'd-1');
    expect(row).toMatchObject({ rev: 0, syncedRev: 11 });
    const batch = await queue.peekBatch(10);
    expect(batch.map((b) => (b.m.op === 'upsert' ? b.m.clientRev : undefined))).toEqual([11, 11]);
  });

  it('persistCardsState includes importId on the upsert row', async () => {
    await persistCardsState([{ copyId: 'c-1', importId: 'imp-1' }] as Array<{
      copyId: string;
      importId?: string;
    }>);
    const stored = await estore.getById('card', 'c-1');
    expect(stored?.importId).toBe('imp-1');
    const batch = await queue.peekBatch(10);
    const upsert = batch.find((b) => b.m.op === 'upsert');
    expect(upsert).toBeDefined();
    expect((upsert?.m as { importId?: string } | undefined)?.importId).toBe('imp-1');
  });

  it.each([
    ['imports', persistImportsState, 'import'],
    ['lists', persistListsState, 'list'],
    ['decks', persistDecksState, 'deck'],
    ['games', persistGamesState, 'game'],
  ] as const)('%s helper writes to its store and enqueues', async (_name, fn, kind) => {
    await fn([{ id: 'x-1' }] as Array<{ id: string }>);
    const live = await estore.getAllLive(kind);
    expect(live.map((r) => r.id)).toEqual(['x-1']);
    const batch = await queue.peekBatch(10);
    expect(batch.some((b) => b.m.op === 'upsert' && b.m.kind === kind && b.m.id === 'x-1')).toBe(
      true
    );
  });
});

describe('card price stripping (prices are device-local, never synced)', () => {
  it('persistCardsState strips purchasePrice/pricedAt from the synced row + queue', async () => {
    mockIsNative.mockReturnValue(true); // asserts the durable queue op
    await persistCardsState([
      { copyId: 'c-1', importId: 'imp-1', scryfallId: 's-1', purchasePrice: 12.5, pricedAt: 123 },
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    const stored = await estore.getById('card', 'c-1');
    const data = stored?.data as Record<string, unknown>;
    expect(data.scryfallId).toBe('s-1');
    expect('purchasePrice' in data).toBe(false);
    expect('pricedAt' in data).toBe(false);
    const upsert = (await queue.peekBatch(10)).find((b) => b.m.op === 'upsert');
    const qData = (upsert?.m as { data: Record<string, unknown> }).data;
    expect('purchasePrice' in qData).toBe(false);
  });

  it('persistCardsState seeds the device price cache (covers add/import/restore/move centrally)', async () => {
    await persistCardsState([
      { copyId: 'c-1', importId: '', scryfallId: 's-1', purchasePrice: 8.5, pricedAt: 111 },
      { copyId: 'c-2', importId: '', scryfallId: 's-2', purchasePrice: 0 }, // no price → not seeded
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    expect(cardPrices.getPrice('s-1')).toEqual({ usd: 8.5, pricedAt: 111 });
    expect(cardPrices.getPrice('s-2')).toBeUndefined();
  });

  it('a pulled card row carries no price; hydrate fills it from the device cache', async () => {
    const { useCollectionStore } = await import('../store/collection');
    cardPrices.setPrices({ 's-9': { usd: 7.25, pricedAt: 999 } });
    mockPull.mockResolvedValueOnce({
      rows: [
        {
          kind: 'card',
          id: 'c-9',
          data: { copyId: 'c-9', scryfallId: 's-9' },
          rev: 1,
          deletedAt: null,
          importId: '',
        },
      ],
      cursor: 1,
      hasMore: false,
    });
    await startSync('user-1');
    const card = useCollectionStore.getState().cards.find((c) => c.copyId === 'c-9');
    expect(card?.purchasePrice).toBe(7.25);
  });
});

describe('card printing-group reject-stale (E129)', () => {
  // Card rows are per-copy; quantity is derived row cardinality for a
  // (scryfallId, finish) group. These cover the client side of the cross-
  // device drift fix: tagging cardinality-changing mutations, sending a
  // fresh baseline at send time, and converging when the server bounces one.
  beforeEach(() => mockIsNative.mockReturnValue(true)); // durable queue is native-only

  it('tags a new copy joining an already-owned printing (candidate for the check)', async () => {
    await estore.putMany('card', [
      {
        id: 'c-1',
        data: { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
        rev: 5,
        deletedAt: null,
      },
    ]);
    await persistCardsState([
      { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
      { copyId: 'c-2', scryfallId: 'S', finish: 'nonfoil' },
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    const batch = await queue.peekBatch(10);
    // c-1 is byte-identical to what's already in IDB → skipped (E38); only
    // the new c-2 is enqueued, tagged with its printing group.
    expect(batch).toHaveLength(1);
    expect(batch[0].m).toMatchObject({
      op: 'upsert',
      id: 'c-2',
      cardGroup: { scryfallId: 'S', finish: 'nonfoil' },
    });
  });

  it('does not tag a brand-new printing with no pre-existing owned copy (bulk import stays cheap)', async () => {
    await persistCardsState([
      { copyId: 'c-1', scryfallId: 'NEW', finish: 'nonfoil' },
      { copyId: 'c-2', scryfallId: 'NEW', finish: 'nonfoil' },
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    const batch = await queue.peekBatch(10);
    expect(batch).toHaveLength(2);
    for (const b of batch) {
      expect((b.m as { cardGroup?: unknown }).cardGroup).toBeUndefined();
    }
  });

  it('tags a delete with its printing group (the row is hard-deleted locally before send time)', async () => {
    await estore.putMany('card', [
      {
        id: 'c-1',
        data: { copyId: 'c-1', scryfallId: 'S', finish: 'foil' },
        rev: 5,
        deletedAt: null,
      },
    ]);
    await persistCardsState([] as Array<{ copyId: string; importId?: string }>); // drops c-1
    const batch = await queue.peekBatch(10);
    expect(batch[0].m).toMatchObject({
      op: 'delete',
      kind: 'card',
      id: 'c-1',
      cardGroup: { scryfallId: 'S', finish: 'foil' },
    });
  });

  it('sends a cardGroupChecks baseline re-derived from live IDB at send time', async () => {
    await estore.putMany('card', [
      {
        id: 'c-1',
        data: { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
        rev: 5,
        syncedRev: 5,
        deletedAt: null,
      },
      {
        id: 'c-2',
        data: { copyId: 'c-2', scryfallId: 'S', finish: 'nonfoil' },
        rev: 5,
        syncedRev: 5,
        deletedAt: null,
      },
    ]);
    await persistCardsState([
      { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
      { copyId: 'c-2', scryfallId: 'S', finish: 'nonfoil' },
      { copyId: 'c-3', scryfallId: 'S', finish: 'nonfoil' }, // new add joining the owned group
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'card', id: 'c-3', rev: 6, deletedAt: null }],
      cursor: 6,
    });
    await startSync('user-1');
    const body = mockPush.mock.calls[0][0] as {
      cardGroupChecks?: Array<{ scryfallId: string; finish: string; baseline: string[] }>;
    };
    // c-3 itself (rev 0, unconfirmed) is excluded from its own baseline — only
    // the two already-confirmed copies are asserted.
    expect(body.cardGroupChecks).toEqual([
      { scryfallId: 'S', finish: 'nonfoil', baseline: ['c-1', 'c-2'] },
    ]);
  });

  it('sends no cardGroupChecks when the batch has no cardinality-changing card op (back-compat)', async () => {
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 1, deletedAt: null }],
      cursor: 1,
    });
    await startSync('user-1');
    const body = mockPush.mock.calls[0][0] as { cardGroupChecks?: unknown };
    expect(body.cardGroupChecks).toBeUndefined();
  });

  it('a pre-E129 queued mutation (no cardGroup tag) still pushes with no cardGroupChecks', async () => {
    // Simulates a mutation queued by a pre-E129 client build still sitting in
    // the durable queue across an app upgrade — the old shape must behave
    // exactly as before: unconditional LWW, no check sent.
    await queue.enqueue({
      op: 'upsert',
      kind: 'card',
      id: 'c-1',
      data: { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
    });
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'card', id: 'c-1', rev: 1, deletedAt: null }],
      cursor: 1,
    });
    await startSync('user-1');
    const body = mockPush.mock.calls[0][0] as { cardGroupChecks?: unknown };
    expect(body.cardGroupChecks).toBeUndefined();
  });

  it('converges on a rejected add: tombstones the optimistic local row, queue not wedged', async () => {
    await estore.putMany('card', [
      {
        id: 'c-1',
        data: { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
        rev: 5,
        syncedRev: 5,
        deletedAt: null,
      },
    ]);
    await persistCardsState([
      { copyId: 'c-1', scryfallId: 'S', finish: 'nonfoil' },
      { copyId: 'c-new', scryfallId: 'S', finish: 'nonfoil' },
    ] as unknown as Array<{ copyId: string; importId?: string }>);
    // Server: another device already grew the group, so c-new's implied baseline
    // no longer matches — rejected, HTTP 200 (never a 409).
    mockPush.mockResolvedValueOnce({
      applied: [],
      conflicts: [{ kind: 'card', id: 'c-new', serverRev: 0, serverData: null }],
      cursor: 0,
    });
    await startSync('user-1');
    // The rejected optimistic add is tombstoned locally (server never had it) —
    // it must not linger as a phantom extra copy.
    const row = await estore.getById('card', 'c-new');
    expect(row?.data).toBeNull();
    expect(row?.deletedAt).toEqual(expect.any(Number));
    // HTTP 200 acks the batch — the queue drains, it is never wedged on a
    // rejected op (a poison-message hazard this design avoids by construction).
    expect(await queue.size()).toBe(0);
  });

  it('converges on a rejected delete: restores the server row + importId, toasts a card-specific message', async () => {
    const { useToastsStore } = await import('../store/toasts');
    useToastsStore.getState().clear();
    await queue.enqueue({
      op: 'delete',
      kind: 'card',
      id: 'c-2',
      cardGroup: { scryfallId: 'S', finish: 'nonfoil' },
    });
    mockPush.mockResolvedValueOnce({
      applied: [],
      conflicts: [
        {
          kind: 'card',
          id: 'c-2',
          serverRev: 9,
          serverData: { copyId: 'c-2', scryfallId: 'S', finish: 'nonfoil' },
          importId: 'imp-1',
        },
      ],
      cursor: 9,
    });
    await startSync('user-1');
    const row = await estore.getById('card', 'c-2');
    expect(row).toMatchObject({
      data: { copyId: 'c-2', scryfallId: 'S', finish: 'nonfoil' },
      rev: 9,
      syncedRev: 9,
      deletedAt: null,
      importId: 'imp-1',
    });
    expect(await queue.size()).toBe(0); // acked, not wedged
    const toasts = useToastsStore.getState().toasts;
    expect(toasts.some((t) => /card quantity changed/i.test(t.message))).toBe(true);
  });
});

describe('legibility signals', () => {
  it('getPendingCount reflects the durable queue depth', async () => {
    mockIsNative.mockReturnValue(true); // durable queue is native-only
    await startSync('user-1');
    expect(getPendingCount()).toBe(0);
    // A mutation enqueues but the push is debounced, so it stays pending.
    await recordUpsert('binder', 'b-1', { id: 'b-1' });
    await vi.waitFor(() => expect(getPendingCount()).toBe(1));
  });

  it('hasSyncError flips true on a failed push and clears on the next success', async () => {
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    mockPush.mockRejectedValueOnce(new Error('offline'));
    await startSync('user-1');
    expect(hasSyncError()).toBe(true);
    // A successful drain clears it.
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 1, deletedAt: null }],
      cursor: 1,
    });
    await flushSync();
    expect(hasSyncError()).toBe(false);
  });

  it('hasSyncError flips true on a failed pull', async () => {
    mockPull.mockRejectedValueOnce(new Error('offline'));
    await startSync('user-1');
    expect(hasSyncError()).toBe(true);
  });

  it('isOnline tracks the browser offline/online events', async () => {
    await startSync('user-1');
    expect(isOnline()).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(isOnline()).toBe(false);
    const before = mockPull.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    expect(isOnline()).toBe(true);
    await vi.waitFor(() => expect(mockPull.mock.calls.length).toBe(before + 1));
    await waitForLifecycleSyncToSettle();
  });
});

describe('isApplyingServer', () => {
  it('is false by default', () => {
    expect(isApplyingServer()).toBe(false);
  });
});

describe('recordUpsert / recordDelete', () => {
  // These assert the native durable-queue path; web write-through has its own
  // describe below.
  beforeEach(() => mockIsNative.mockReturnValue(true));

  it('recordUpsert writes IDB + enqueues a single op', async () => {
    const { recordUpsert } = await import('./sync');
    await recordUpsert('binder', 'b-1', { id: 'b-1', name: 'A' });
    const row = await estore.getById('binder', 'b-1');
    expect(row?.data).toEqual({ id: 'b-1', name: 'A' });
    const batch = await queue.peekBatch(10);
    expect(batch).toHaveLength(1);
    expect(batch[0].m).toMatchObject({ op: 'upsert', kind: 'binder', id: 'b-1' });
  });

  it('recordUpsert for a card stamps importId on both the IDB row and the queue op', async () => {
    const { recordUpsert } = await import('./sync');
    await recordUpsert('card', 'c-1', { copyId: 'c-1' }, 'imp-1');
    const row = await estore.getById('card', 'c-1');
    expect(row?.importId).toBe('imp-1');
    const batch = await queue.peekBatch(10);
    expect((batch[0].m as { importId?: string }).importId).toBe('imp-1');
  });

  it('recordUpsert uses the pre-edit deck rev as clientRev', async () => {
    const { recordUpsert } = await import('./sync');
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', name: 'old' }, rev: 21, deletedAt: null },
    ]);
    await recordUpsert('deck', 'd-1', { id: 'd-1', name: 'new' });
    const row = await estore.getById('deck', 'd-1');
    expect(row).toMatchObject({ rev: 0, syncedRev: 21 });
    const batch = await queue.peekBatch(10);
    expect(batch[0].m).toMatchObject({ op: 'upsert', kind: 'deck', id: 'd-1', clientRev: 21 });
  });

  it('recordDelete removes the IDB row + enqueues a delete op', async () => {
    const { recordUpsert, recordDelete } = await import('./sync');
    await recordUpsert('binder', 'b-1', { id: 'b-1' });
    await queue.clear();
    await recordDelete('binder', 'b-1');
    expect(await estore.getById('binder', 'b-1')).toBeUndefined();
    const batch = await queue.peekBatch(10);
    expect(batch[0].m).toEqual({ op: 'delete', kind: 'binder', id: 'b-1' });
  });
});

describe('web guest (signed-out) keeps the durable queue', () => {
  it('a guest mutation enqueues (to promote on sign-in) and does not POST', async () => {
    // web (default), no startSync → no owner → durable queue, no write-through.
    await recordUpsert('binder', 'b-g', { id: 'b-g' });
    const batch = await queue.peekBatch(10);
    expect(batch.map((b) => `${b.m.op}:${b.m.id}`)).toEqual(['upsert:b-g']);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('web write-through (no durable outbox)', () => {
  // isNativePlatform defaults to false (web). Write-through is gated on a
  // signed-in owner — a guest still uses the durable queue — so sign in first.
  beforeEach(async () => {
    await startSync('user-1');
  });

  type PushBody = {
    upserts: Array<{ kind: string; id: string; clientRev?: number }>;
    deletions: Array<{ kind: string; id: string }>;
  };

  it('recordUpsert POSTs straight to the server and stamps the server rev — no queue', async () => {
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 5, deletedAt: null }],
      cursor: 5,
    });
    await recordUpsert('binder', 'b-1', { id: 'b-1', name: 'A' });
    const row = await estore.getById('binder', 'b-1');
    expect(row?.data).toEqual({ id: 'b-1', name: 'A' });
    expect(row?.rev).toBe(5); // applyPushResult stamped the canonical rev
    expect(await queue.peekBatch(10)).toHaveLength(0); // no durable outbox
    const body = mockPush.mock.calls[0][0] as PushBody;
    expect(body.upserts.map((u) => u.id)).toEqual(['b-1']);
    expect(body.deletions).toEqual([]);
  });

  it('a failed write reverts an edited row to its pre-edit value and flags the error', async () => {
    await estore.putMany('binder', [
      { id: 'b-1', data: { id: 'b-1', name: 'old' }, rev: 3, deletedAt: null },
    ]);
    mockPush.mockRejectedValueOnce(new Error('offline'));
    await recordUpsert('binder', 'b-1', { id: 'b-1', name: 'new' });
    const row = await estore.getById('binder', 'b-1');
    expect(row?.data).toEqual({ id: 'b-1', name: 'old' }); // reverted
    expect(row?.rev).toBe(3);
    expect(await queue.peekBatch(10)).toHaveLength(0);
    expect(hasSyncError()).toBe(true);
  });

  it('a failed write removes an optimistically-added new row', async () => {
    mockPush.mockRejectedValueOnce(new Error('offline'));
    await recordUpsert('binder', 'b-new', { id: 'b-new' });
    expect(await estore.getById('binder', 'b-new')).toBeUndefined();
  });

  it('persistKind sends the whole delta (upsert + tombstone) in one POST', async () => {
    await estore.putMany('binder', [
      { id: 'b-2', data: { id: 'b-2', name: 'old' }, rev: 2, deletedAt: null },
    ]);
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 9, deletedAt: null }],
      cursor: 9,
    });
    await persistBindersState([{ id: 'b-1', name: 'new' } as { id: string }]);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const body = mockPush.mock.calls[0][0] as PushBody;
    expect(body.upserts.map((u) => u.id)).toEqual(['b-1']);
    expect(body.deletions.map((d) => d.id)).toEqual(['b-2']);
    expect(await queue.peekBatch(10)).toHaveLength(0);
  });

  it('chunks a big collection into <=500-op POSTs (no 413)', async () => {
    // Regression: an un-chunked web push of a large import sent every card in one
    // POST, blowing past the server's 5000-op cap → 413 → "Change could not be
    // saved" and the collection never synced on mobile web.
    const cards = Array.from({ length: 1100 }, (_, i) => ({ copyId: `c-${i}` }));
    await persistCardsState(cards as Array<{ copyId: string; importId?: string }>);
    const sizes = (mockPush.mock.calls as Array<[PushBody]>).map(
      ([b]) => b.upserts.length + b.deletions.length
    );
    expect(sizes).toEqual([500, 500, 100]); // 1100 split into 500/500/100
    expect(Math.max(...sizes)).toBeLessThanOrEqual(500);
    expect(hasSyncError()).toBe(false);
  });

  it('a mid-collection push failure reverts only the un-pushed chunk', async () => {
    // First chunk lands; second 413s. The 500 rows already accepted must keep
    // their stamped state — only the unsent tail reverts.
    const cards = Array.from({ length: 600 }, (_, i) => ({ copyId: `c-${i}` }));
    mockPush.mockReset();
    mockPush
      .mockResolvedValueOnce({ applied: [], cursor: 1 })
      .mockRejectedValueOnce(new Error('413'));
    await persistCardsState(cards as Array<{ copyId: string; importId?: string }>);
    expect(await estore.getById('card', 'c-0')).toBeDefined(); // first chunk survived
    expect(await estore.getById('card', 'c-500')).toBeUndefined(); // tail reverted
    expect(hasSyncError()).toBe(true);
  });

  it('does not revert a server-committed chunk when the local rev-stamp throws (F19)', async () => {
    // Server accepts the write (pushSync resolves)…
    await estore.putMany('binder', [
      { id: 'b-1', data: { id: 'b-1', name: 'old' }, rev: 3, deletedAt: null },
    ]);
    mockPush.mockResolvedValueOnce({
      applied: [{ kind: 'binder', id: 'b-1', rev: 5, deletedAt: null }],
      cursor: 5,
    });
    // …but the local rev-stamp IDB write inside applyPushResult throws. That
    // write is the one carrying a stamped rev (>0); the optimistic write (rev 0)
    // must still go through.
    const orig = estore.putMany;
    const spy = vi.spyOn(estore, 'putMany').mockImplementation(async (kind, rows) => {
      if (rows.some((r) => (r.rev ?? 0) > 0)) throw new Error('idb stamp failed');
      return orig(kind, rows);
    });

    await recordUpsert('binder', 'b-1', { id: 'b-1', name: 'new' });
    spy.mockRestore();

    // The server committed 'new'; it must NOT be reverted to 'old'.
    const row = await estore.getById('binder', 'b-1');
    expect(row?.data).toEqual({ id: 'b-1', name: 'new' });
  });

  it('two rapid same-deck edits do not self-conflict on one device', async () => {
    // The reported bug: editing a deck twice quickly on web fired "Deck changed
    // on another device" and dropped the second edit — with NO other device. The
    // two write-throughs raced, both sending the same pre-ack base rev; the
    // server reject-staled the loser. The fix serializes web writes and derives
    // each clientRev from the syncedRev the prior write stamped.
    const { useToastsStore } = await import('../store/toasts');
    useToastsStore.getState().clear();
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', n: 0 }, rev: 100, syncedRev: 100, deletedAt: null },
    ]);

    // Faithful server stand-in: strict rev = clientRev reject-stale, like the
    // real backend (UPDATE ... WHERE rev = $clientRev). A mismatch → conflict.
    let serverRev = 100;
    let serverData: unknown = { id: 'd-1', n: 0 };
    mockPush.mockImplementation(
      async ({
        upserts,
      }: {
        upserts: Array<{ kind: string; id: string; data: unknown; clientRev?: number }>;
      }) => {
        const u = upserts[0];
        if (u.kind === 'deck' && u.clientRev !== undefined && u.clientRev !== serverRev) {
          return {
            applied: [],
            conflicts: [{ kind: 'deck', id: u.id, serverRev, serverData }],
            cursor: serverRev,
          };
        }
        serverRev += 1;
        serverData = u.data;
        return {
          applied: [{ kind: 'deck', id: u.id, rev: serverRev, deletedAt: null }],
          cursor: serverRev,
        };
      }
    );

    // Fire both edits without awaiting the first — rapid typing on web.
    const p1 = recordUpsert('deck', 'd-1', { id: 'd-1', n: 1 });
    const p2 = recordUpsert('deck', 'd-1', { id: 'd-1', n: 2 });
    await Promise.all([p1, p2]);

    // No phantom-conflict toast, and the second edit won (converged, not dropped).
    const toasts = useToastsStore.getState().toasts;
    expect(toasts.some((t) => /another device/i.test(t.message))).toBe(false);
    const row = await estore.getById('deck', 'd-1');
    expect((row?.data as { n: number }).n).toBe(2);
    expect(row).toMatchObject({ rev: 102, syncedRev: 102 });
  });

  it('adopts a server deck conflict (reject-stale works on web too)', async () => {
    await estore.putMany('deck', [
      { id: 'd-1', data: { id: 'd-1', name: 'mine' }, rev: 4, deletedAt: null },
    ]);
    mockPush.mockResolvedValueOnce({
      applied: [],
      conflicts: [
        { kind: 'deck', id: 'd-1', serverRev: 6, serverData: { id: 'd-1', name: 'theirs' } },
      ],
      cursor: 6,
    });
    await recordUpsert('deck', 'd-1', { id: 'd-1', name: 'mine edited' });
    const row = await estore.getById('deck', 'd-1');
    expect(row?.data).toEqual({ id: 'd-1', name: 'theirs' }); // server version won
    expect(row?.rev).toBe(6);
    // it sent our pre-edit base rev as clientRev so the server could reject-stale
    const body = mockPush.mock.calls[0][0] as PushBody;
    expect(body.upserts[0].clientRev).toBe(4);
  });
});

describe('withSuspendedHydration', () => {
  it('returns the wrapped value and resets the flag', async () => {
    const { withSuspendedHydration } = await import('./sync');
    const result = await withSuspendedHydration(async () => 42);
    expect(result).toBe(42);
  });

  it('resets the suspension flag even when the wrapped fn throws', async () => {
    const { withSuspendedHydration } = await import('./sync');
    await expect(
      withSuspendedHydration(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('lifecycle guards', () => {
  it('push() is a no-op when there is no current owner', async () => {
    // No startSync, no currentOwnerId. Enqueue something; flushSync should not push.
    await queue.enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await flushSync();
    expect(mockPush).not.toHaveBeenCalled();
    // The queue is intact.
    expect(await queue.size()).toBe(1);
  });

  it('startSync without a userId triggers a pull anyway', async () => {
    // The arg is optional — hydration-only paths still tick the listeners.
    await startSync();
    // No owner means push and pull both bail; mockPull was not called.
    expect(mockPull).not.toHaveBeenCalled();
  });
});
