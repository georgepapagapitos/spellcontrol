// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
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
