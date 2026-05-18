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
  };
}

beforeEach(async () => {
  await clearCollection();
  useDecksStore.setState({ decks: [], hydrated: true });
  useCollectionStore.setState({
    cards: [],
    binders: [],
    subCollections: [],
    fileName: '',
    importHistory: [],
    uploadedAt: null,
    hydrating: false,
  });
});

describe('sub-collection CRUD', () => {
  it('creates a sub-collection with a clamped, trimmed name and returns its id', () => {
    const id = useCollectionStore.getState().createSubCollection('  Bulk  ');
    const defs = useCollectionStore.getState().subCollections;
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ id, name: 'Bulk', order: 0 });
  });

  it('renames and recolors', () => {
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    useCollectionStore.getState().renameSubCollection(id, 'Trade');
    useCollectionStore.getState().recolorSubCollection(id, '#ff0000');
    const def = useCollectionStore.getState().subCollections[0];
    expect(def).toMatchObject({ name: 'Trade', color: '#ff0000' });
  });

  it('moves cards into a sub-collection and stamps the durable key', async () => {
    useCollectionStore.setState({ cards: [enriched('c1', 'sf1')] });
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore.getState().moveCardsToSubCollection(['c1'], id);
    const c = useCollectionStore.getState().cards[0];
    expect(c.subCollectionId).toBe(id);
    expect(c.subCollectionKey).toBe('sf1:nonfoil');
    const stored = await loadCollection();
    expect(stored?.subCollections?.[0].id).toBe(id);
    expect(stored?.cards[0].subCollectionId).toBe(id);
  });

  it('deleting a sub-collection sends its cards back to Main', async () => {
    useCollectionStore.setState({ cards: [enriched('c1', 'sf1')] });
    const id = useCollectionStore.getState().createSubCollection('Bulk');
    await useCollectionStore.getState().moveCardsToSubCollection(['c1'], id);
    await useCollectionStore.getState().deleteSubCollection(id);
    expect(useCollectionStore.getState().subCollections).toHaveLength(0);
    const c = useCollectionStore.getState().cards[0];
    expect(c.subCollectionId).toBeUndefined();
    expect(c.subCollectionKey).toBeUndefined();
  });

  it('reorders sub-collections by id list', () => {
    const a = useCollectionStore.getState().createSubCollection('A');
    const b = useCollectionStore.getState().createSubCollection('B');
    useCollectionStore.getState().reorderSubCollections([b, a]);
    const defs = useCollectionStore.getState().subCollections;
    expect(defs.map((d) => d.id)).toEqual([b, a]);
    expect(defs.map((d) => d.order)).toEqual([0, 1]);
  });
});
