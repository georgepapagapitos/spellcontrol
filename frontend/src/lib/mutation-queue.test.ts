// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  enqueue,
  enqueueBatch,
  peekBatch,
  ack,
  size,
  clear,
  _resetDbPromiseForTests,
} from './mutation-queue';

beforeEach(async () => {
  _resetDbPromiseForTests();
  // fake-indexeddb's auto setup gives each test file a fresh global indexedDB,
  // but the queue's memoized DB connection can carry across tests within the
  // file. Drop the cached promise + clear the (newly-opened) store so each test
  // starts from an empty queue.
  await clear();
});

describe('enqueue', () => {
  it('appends an op with an auto-assigned seq', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(1);
    expect(batch[0].m).toEqual({ op: 'upsert', kind: 'binder', id: 'b-1', data: { id: 'b-1' } });
    expect(typeof batch[0].seq).toBe('number');
  });

  it('coalesces consecutive upserts of the same row, keeping the latest', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 1 } });
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 2 } });
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 3 } });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(1);
    expect((batch[0].m as { data: { v: number } }).data.v).toBe(3);
  });

  it('does not coalesce across different ids', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 1 } });
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-2', data: { v: 1 } });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(2);
  });

  it('does not coalesce across different kinds', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'x', data: {} });
    await enqueue({ op: 'upsert', kind: 'deck', id: 'x', data: {} });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(2);
  });

  it('does not coalesce an upsert into a prior delete', async () => {
    await enqueue({ op: 'delete', kind: 'binder', id: 'b-1' });
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 1 } });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(2);
    expect(batch[0].m.op).toBe('delete');
    expect(batch[1].m.op).toBe('upsert');
  });

  it('does not coalesce a delete into a prior upsert', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await enqueue({ op: 'delete', kind: 'binder', id: 'b-1' });
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(2);
  });
});

describe('enqueueBatch', () => {
  it('appends every op without coalescing across the batch', async () => {
    await enqueueBatch([
      { op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 1 } },
      { op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 2 } },
      { op: 'delete', kind: 'deck', id: 'd-1' },
    ]);
    const batch = await peekBatch(10);
    expect(batch).toHaveLength(3);
  });

  it('is a no-op for an empty array', async () => {
    await enqueueBatch([]);
    expect(await size()).toBe(0);
  });
});

describe('peekBatch', () => {
  it('returns FIFO order', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: { v: 1 } });
    await enqueue({ op: 'upsert', kind: 'deck', id: 'd-1', data: { v: 1 } });
    const batch = await peekBatch(10);
    expect(batch.map((b) => `${b.m.kind}:${b.m.id}`)).toEqual(['binder:b-1', 'deck:d-1']);
  });

  it('respects the limit argument', async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue({ op: 'upsert', kind: 'binder', id: `b-${i}`, data: {} });
    }
    const batch = await peekBatch(3);
    expect(batch).toHaveLength(3);
  });

  it('returns an empty array when the queue is empty', async () => {
    expect(await peekBatch(10)).toEqual([]);
  });

  it('returns an empty array for a non-positive limit', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    expect(await peekBatch(0)).toEqual([]);
    expect(await peekBatch(-1)).toEqual([]);
  });
});

describe('ack', () => {
  it('removes the named seqs from the queue', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await enqueue({ op: 'upsert', kind: 'deck', id: 'd-1', data: {} });
    const batch = await peekBatch(10);
    await ack([batch[0].seq]);
    const remaining = await peekBatch(10);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].m.id).toBe('d-1');
  });

  it('is a no-op for an empty seq array', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await ack([]);
    expect(await size()).toBe(1);
  });
});

describe('size + clear', () => {
  it('reports the current queue size', async () => {
    expect(await size()).toBe(0);
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await enqueue({ op: 'upsert', kind: 'deck', id: 'd-1', data: {} });
    expect(await size()).toBe(2);
  });

  it('clear() drops every entry', async () => {
    await enqueue({ op: 'upsert', kind: 'binder', id: 'b-1', data: {} });
    await enqueue({ op: 'upsert', kind: 'deck', id: 'd-1', data: {} });
    await clear();
    expect(await size()).toBe(0);
    expect(await peekBatch(10)).toEqual([]);
  });
});
