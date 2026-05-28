// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_KINDS,
  getAllLive,
  getById,
  putMany,
  putTombstone,
  deleteMany,
  wipeAll,
  deleteLegacyDatabasesOnce,
  _resetDbPromiseForTests,
  type EntityKind,
} from './entity-store';

beforeEach(async () => {
  _resetDbPromiseForTests();
  await wipeAll();
});

describe('putMany + getAllLive', () => {
  it('round-trips rows across all kinds', async () => {
    const cases: Array<{ kind: EntityKind; id: string }> = ALL_KINDS.map((k) => ({
      kind: k,
      id: `${k}-1`,
    }));
    for (const c of cases) {
      const row =
        c.kind === 'card'
          ? { id: c.id, data: { copyId: c.id }, rev: 1, deletedAt: null, importId: 'imp-1' }
          : { id: c.id, data: { id: c.id }, rev: 1, deletedAt: null };
      await putMany(c.kind, [row]);
    }
    for (const c of cases) {
      const rows = await getAllLive(c.kind);
      expect(rows.map((r) => r.id)).toContain(c.id);
    }
  });

  it('filters tombstones out of getAllLive', async () => {
    await putMany('binder', [
      { id: 'b-live', data: { id: 'b-live' }, rev: 1, deletedAt: null },
      { id: 'b-dead', data: null, rev: 2, deletedAt: 1700000000000 },
    ]);
    const live = await getAllLive('binder');
    expect(live.map((r) => r.id)).toEqual(['b-live']);
  });

  it('upserts by id (subsequent put replaces)', async () => {
    await putMany('binder', [{ id: 'b-1', data: { v: 1 }, rev: 1, deletedAt: null }]);
    await putMany('binder', [{ id: 'b-1', data: { v: 2 }, rev: 2, deletedAt: null }]);
    const rows = await getAllLive('binder');
    expect(rows).toHaveLength(1);
    expect((rows[0].data as { v: number }).v).toBe(2);
    expect(rows[0].rev).toBe(2);
  });

  it('is a no-op on an empty rows array', async () => {
    await putMany('binder', []);
    expect(await getAllLive('binder')).toEqual([]);
  });
});

describe('getById', () => {
  it('returns the row when present', async () => {
    await putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }]);
    const row = await getById('binder', 'b-1');
    expect(row?.id).toBe('b-1');
  });

  it('returns undefined when absent', async () => {
    expect(await getById('binder', 'missing')).toBeUndefined();
  });

  it('also returns tombstones (unlike getAllLive)', async () => {
    await putMany('binder', [{ id: 'b-1', data: null, rev: 5, deletedAt: 1700000000000 }]);
    const row = await getById('binder', 'b-1');
    expect(row?.deletedAt).toBe(1700000000000);
  });
});

describe('putTombstone', () => {
  it('writes a tombstone row that hides from getAllLive', async () => {
    await putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }]);
    await putTombstone('binder', 'b-1', 7, 1700000123000);
    expect(await getAllLive('binder')).toEqual([]);
    const row = await getById('binder', 'b-1');
    expect(row?.deletedAt).toBe(1700000123000);
    expect(row?.rev).toBe(7);
    expect(row?.data).toBeNull();
  });
});

describe('deleteMany', () => {
  it('hard-deletes the named ids', async () => {
    await putMany('binder', [
      { id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null },
      { id: 'b-2', data: { id: 'b-2' }, rev: 2, deletedAt: null },
    ]);
    await deleteMany('binder', ['b-1']);
    const rows = await getAllLive('binder');
    expect(rows.map((r) => r.id)).toEqual(['b-2']);
    expect(await getById('binder', 'b-1')).toBeUndefined();
  });

  it('is a no-op on an empty ids array', async () => {
    await deleteMany('binder', []);
    expect(await getAllLive('binder')).toEqual([]);
  });
});

describe('wipeAll', () => {
  it('clears every store', async () => {
    await putMany('binder', [{ id: 'b-1', data: { id: 'b-1' }, rev: 1, deletedAt: null }]);
    await putMany('deck', [{ id: 'd-1', data: { id: 'd-1' }, rev: 1, deletedAt: null }]);
    await putMany('card', [
      { id: 'c-1', data: { copyId: 'c-1' }, rev: 1, deletedAt: null, importId: 'imp-1' },
    ]);
    await wipeAll();
    expect(await getAllLive('binder')).toEqual([]);
    expect(await getAllLive('deck')).toEqual([]);
    expect(await getAllLive('card')).toEqual([]);
  });
});

describe('deleteLegacyDatabasesOnce', () => {
  it('does not throw when the legacy DB is absent', async () => {
    await expect(deleteLegacyDatabasesOnce()).resolves.toBeUndefined();
  });
});
