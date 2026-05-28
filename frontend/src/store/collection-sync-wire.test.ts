// @vitest-environment happy-dom
/**
 * Wire-path regression tests for the sync layer. The original concern these
 * cover: until this PR, store mutators wrote to local IDB via `saveCollection`
 * but never enqueued mutations for the server — so a "clear collection" on one
 * device would persist locally but the server would still hold the old rows,
 * and the next pull would resurrect them. These tests assert that for every
 * synced kind (cards, imports, lists, binders, decks), a mutation that
 * changes the in-memory store also produces a queued sync op.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCollectionStore } from './collection';
import { useDecksStore } from './decks';
import { clearCollection } from '../lib/local-cards';
import * as queue from '../lib/mutation-queue';
import * as estore from '../lib/entity-store';
import type { EnrichedCard, UploadResponse } from '../types';

function enriched(copyId: string, scryfallId: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
    scryfallId,
  } as EnrichedCard;
}

function uploadResponse(cards: EnrichedCard[]): UploadResponse {
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    detectedFormat: 'plain',
  };
}

beforeEach(async () => {
  estore._resetDbPromiseForTests();
  queue._resetDbPromiseForTests();
  localStorage.clear();
  await estore.wipeAll();
  await queue.clear();
  await clearCollection();
  // clearCollection itself enqueues tombstones (which is correct), but for the
  // tests below we want a clean queue too so we can assert about what THIS test
  // enqueued.
  await queue.clear();
  useDecksStore.setState({ decks: [], hydrated: true });
  useCollectionStore.setState({
    cards: [],
    binders: [],
    lists: [],
    fileName: '',
    importHistory: [],
    uploadedAt: null,
    hydrating: false,
  });
});

async function queuedOps(): Promise<Array<{ op: string; kind: string; id: string }>> {
  const batch = await queue.peekBatch(1000);
  return batch.map(({ m }) => ({ op: m.op, kind: m.kind, id: m.id }));
}

/**
 * Poll the queue until the predicate is satisfied or a 250 ms budget runs out.
 * Subscriber-driven persists are async (lazy import + IDB writes); a fixed
 * setTimeout doesn't reliably catch them under coverage / loaded test runners.
 */
async function waitForQueue(
  pred: (ops: Array<{ op: string; kind: string; id: string }>) => boolean,
  budgetMs = 500
): Promise<Array<{ op: string; kind: string; id: string }>> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const ops = await queuedOps();
    if (pred(ops)) return ops;
    await new Promise((r) => setTimeout(r, 10));
  }
  return queuedOps();
}

describe('cards → sync queue', () => {
  it('importCards enqueues an upsert for each new card + its import', async () => {
    await useCollectionStore
      .getState()
      .importCards(
        uploadResponse([enriched('c-1', 'sf-1'), enriched('c-2', 'sf-2')]),
        'mine.csv',
        'replace'
      );
    const ops = await queuedOps();
    const cardUpserts = ops.filter((o) => o.op === 'upsert' && o.kind === 'card');
    const importUpserts = ops.filter((o) => o.op === 'upsert' && o.kind === 'import');
    expect(cardUpserts.map((o) => o.id).sort()).toEqual(['c-1', 'c-2']);
    expect(importUpserts).toHaveLength(1);
  });

  it('clearCards enqueues a delete for every card', async () => {
    // Seed two cards, then drain the queue so we only see what clearCards adds.
    await useCollectionStore
      .getState()
      .importCards(
        uploadResponse([enriched('c-1', 'sf-1'), enriched('c-2', 'sf-2')]),
        'mine.csv',
        'replace'
      );
    await queue.clear();
    await useCollectionStore.getState().clearCards();
    const ops = await queuedOps();
    const cardDeletes = ops.filter((o) => o.op === 'delete' && o.kind === 'card');
    expect(cardDeletes.map((o) => o.id).sort()).toEqual(['c-1', 'c-2']);
  });

  it('deleteImports enqueues a delete for the import (server cascades to its cards)', async () => {
    const importId = await useCollectionStore
      .getState()
      .importCards(uploadResponse([enriched('c-1', 'sf-1')]), 'mine.csv', 'replace');
    await queue.clear();
    await useCollectionStore.getState().deleteImports([importId]);
    const ops = await queuedOps();
    const importDeletes = ops.filter((o) => o.op === 'delete' && o.kind === 'import');
    expect(importDeletes.map((o) => o.id)).toContain(importId);
  });
});

describe('lists → sync queue', () => {
  it('createList enqueues an upsert', async () => {
    const id = useCollectionStore.getState().createList('Wishlist');
    // Wait for the void-returning persistCollection to settle.
    await Promise.resolve();
    await useCollectionStore.getState().persistCollection();
    const ops = await queuedOps();
    const listUpserts = ops.filter((o) => o.op === 'upsert' && o.kind === 'list');
    expect(listUpserts.map((o) => o.id)).toContain(id);
  });

  it('deleteList enqueues a delete', async () => {
    const id = useCollectionStore.getState().createList('Goners');
    await useCollectionStore.getState().persistCollection();
    await queue.clear();
    useCollectionStore.getState().deleteList(id);
    await useCollectionStore.getState().persistCollection();
    const ops = await queuedOps();
    const listDeletes = ops.filter((o) => o.op === 'delete' && o.kind === 'list');
    expect(listDeletes.map((o) => o.id)).toContain(id);
  });
});

describe('binders → sync queue (via subscriber)', () => {
  it('createBinder enqueues an upsert', async () => {
    const def = useCollectionStore.getState().createBinder({
      name: 'Main',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [],
      pocketSize: null,
      doubleSided: false,
      fixedCapacity: null,
      color: '#888',
    });
    const ops = await waitForQueue((o) =>
      o.some((x) => x.op === 'upsert' && x.kind === 'binder' && x.id === def.id)
    );
    expect(ops.some((o) => o.op === 'upsert' && o.kind === 'binder' && o.id === def.id)).toBe(true);
  });
});

describe('decks → sync queue (via subscriber)', () => {
  it('createDeck enqueues an upsert', async () => {
    const id = useDecksStore.getState().createDeck({
      source: 'manual',
      commander: null,
      name: 'Test',
    });
    const ops = await waitForQueue((o) =>
      o.some((x) => x.op === 'upsert' && x.kind === 'deck' && x.id === id)
    );
    expect(ops.some((o) => o.op === 'upsert' && o.kind === 'deck' && o.id === id)).toBe(true);
  });
});
