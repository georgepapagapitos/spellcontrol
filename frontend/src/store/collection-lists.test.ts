// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCollectionStore } from './collection';
import { useDecksStore } from './decks';
import { clearCollection, loadCollection } from '../lib/local-cards';
import type { EnrichedCard } from '../types';

function enriched(copyId: string, scryfallId: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    oracleId: 'oracle-solring',
  };
}

beforeEach(async () => {
  await clearCollection();
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

describe('list CRUD', () => {
  it('creates a list with clamped name, returns id', () => {
    const id = useCollectionStore.getState().createList('  Wants  ');
    const lists = useCollectionStore.getState().lists;
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ id, name: 'Wants', order: 0 });
    expect(lists[0].entries).toEqual([]);
  });

  it('creates a dynamic list with a rule and updates it via setListRule', async () => {
    const rule = [{ filter: { nameContains: 'sol' } }];
    const id = useCollectionStore.getState().createList('Commanders', []);
    expect(useCollectionStore.getState().lists[0].rule).toEqual([]);
    useCollectionStore.getState().setListRule(id, rule);
    const list = useCollectionStore.getState().lists[0];
    expect(list.rule).toEqual(rule);
    expect(list.entries).toEqual([]);
    // setListRule persists fire-and-forget (like renameList) — poll until the
    // rule lands in the cache so the assertion isn't racing the IDB write.
    await vi.waitFor(async () => {
      const stored = await loadCollection();
      expect(stored?.lists?.[0].rule).toEqual(rule);
    });
    // Static lists stay rule-less.
    useCollectionStore.getState().createList('Wants');
    expect(useCollectionStore.getState().lists[1].rule).toBeUndefined();
  });

  it('renames, reorders, deletes', () => {
    const a = useCollectionStore.getState().createList('A');
    const b = useCollectionStore.getState().createList('B');
    useCollectionStore.getState().renameList(a, 'A2');
    useCollectionStore.getState().reorderLists([b, a]);
    let lists = useCollectionStore.getState().lists;
    expect(lists.map((l) => l.id)).toEqual([b, a]);
    expect(lists.find((l) => l.id === a)).toMatchObject({ name: 'A2', order: 1 });
    useCollectionStore.getState().deleteList(b);
    lists = useCollectionStore.getState().lists;
    expect(lists.map((l) => l.id)).toEqual([a]);
    expect(lists[0].order).toBe(0);
  });
});

describe('list entries', () => {
  it('adds, updates, removes an entry and persists', async () => {
    const id = useCollectionStore.getState().createList('Wants');
    const card = enriched('c1', 'sf1');
    await useCollectionStore.getState().addListEntry(id, card, 2);
    let entries = useCollectionStore.getState().lists[0].entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', scryfallId: 'sf1', quantity: 2 });
    const entryId = entries[0].id;
    await useCollectionStore
      .getState()
      .updateListEntry(id, entryId, { quantity: 5, note: 'x', targetPrice: 3 });
    entries = useCollectionStore.getState().lists[0].entries;
    expect(entries[0]).toMatchObject({ quantity: 5, note: 'x', targetPrice: 3 });
    const stored = await loadCollection();
    expect(stored?.lists?.[0].entries[0].quantity).toBe(5);
    await useCollectionStore.getState().removeListEntry(id, entryId);
    expect(useCollectionStore.getState().lists[0].entries).toHaveLength(0);
  });

  it('addListEntries bulk-adds, dedups by printing+finish, returns counts', async () => {
    const id = useCollectionStore.getState().createList('Ramp');
    // Seed one card so the dedup path has something to skip.
    await useCollectionStore.getState().addListEntry(id, enriched('c1', 'sf1'), 1);

    const res = await useCollectionStore.getState().addListEntries(id, [
      { card: enriched('c2', 'sf1') }, // same printing as the seed → skipped
      { card: enriched('c3', 'sf2'), quantity: 3 }, // new → added
      { card: enriched('c4', 'sf2') }, // dup of sf2 within the batch → skipped
    ]);

    expect(res).toEqual({ added: 1, skipped: 2 });
    const entries = useCollectionStore.getState().lists[0].entries;
    expect(entries.map((e) => e.scryfallId).sort()).toEqual(['sf1', 'sf2']);
    expect(entries.find((e) => e.scryfallId === 'sf2')?.quantity).toBe(3);

    const stored = await loadCollection();
    expect(stored?.lists?.[0].entries).toHaveLength(2);
  });

  it('addListEntries on a missing list is a no-op', async () => {
    const res = await useCollectionStore
      .getState()
      .addListEntries('nope', [{ card: enriched('c1', 'sf1') }]);
    expect(res).toEqual({ added: 0, skipped: 0 });
  });

  it('moveListEntryToCollection adds owned cards and removes the entry', async () => {
    const id = useCollectionStore.getState().createList('Wants');
    await useCollectionStore.getState().addListEntry(id, enriched('c1', 'sf1'), 3);
    const entryId = useCollectionStore.getState().lists[0].entries[0].id;
    await useCollectionStore.getState().moveListEntryToCollection(id, entryId);
    const cards = useCollectionStore.getState().cards;
    expect(cards.filter((c) => c.scryfallId === 'sf1')).toHaveLength(3);
    expect(useCollectionStore.getState().lists[0].entries).toHaveLength(0);
    const stored = await loadCollection();
    expect(stored?.cards.filter((c) => c.scryfallId === 'sf1')).toHaveLength(3);
  });
});

describe('persistence regression (buildStored coverage)', () => {
  it('addCard preserves lists in the cache', async () => {
    const listId = useCollectionStore.getState().createList('Wants');
    // addCard takes a ScryfallCard; minimal shape is enough for scryfallToEnrichedCard.
    await useCollectionStore.getState().addCard({
      id: 'sfX',
      name: 'Test',
      set: 'tst',
      set_name: 'Test Set',
      collector_number: '1',
      rarity: 'common',
      oracle_id: 'o1',
    } as never);
    const stored = await loadCollection();
    expect(stored?.lists?.some((l) => l.id === listId)).toBe(true);
    expect(stored?.cards.some((c) => c.scryfallId === 'sfX')).toBe(true);
  });
});
