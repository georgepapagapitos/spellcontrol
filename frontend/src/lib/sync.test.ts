// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock the network layer — tests drive the driver with fixture pull pages
// and assert on the push payloads it builds.
vi.mock('./auth-api', () => ({
  pullSync: vi.fn(),
  pushSync: vi.fn(),
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
} from './sync';
import { pullSync, pushSync } from './auth-api';
import * as estore from './entity-store';
import * as queue from './mutation-queue';

const mockPull = pullSync as unknown as ReturnType<typeof vi.fn>;
const mockPush = pushSync as unknown as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  estore._resetDbPromiseForTests();
  queue._resetDbPromiseForTests();
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
  // Default: empty pull, empty push.
  mockPull.mockResolvedValue({ rows: [], cursor: 0, hasMore: false });
  mockPush.mockResolvedValue({ applied: [], cursor: 0 });
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
    expect(mockPull).toHaveBeenLastCalledWith(42);
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
    expect(mockPull).toHaveBeenNthCalledWith(1, 0);
    expect(mockPull).toHaveBeenNthCalledWith(2, 1);
    expect((await estore.getAllLive('binder')).map((r) => r.id).sort()).toEqual(['b-1', 'b-2']);
  });

  it("doesn't crash when the network throws", async () => {
    mockPull.mockRejectedValueOnce(new Error('offline'));
    await expect(startSync('user-1')).resolves.toBeUndefined();
    expect(getSyncState()).toBe('ready');
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

describe('isApplyingServer', () => {
  it('is false by default', () => {
    expect(isApplyingServer()).toBe(false);
  });
});

describe('recordUpsert / recordDelete', () => {
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
