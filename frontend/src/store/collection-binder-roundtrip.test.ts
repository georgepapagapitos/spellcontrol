// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCollectionStore } from './collection';
import { useDecksStore } from './decks';
import { clearCollection } from '../lib/local-cards';
import type { BinderDef, EnrichedCard, UploadResponse } from '../types';

function enriched(
  copyId: string,
  scryfallId: string,
  finish: 'nonfoil' | 'foil' = 'nonfoil'
): EnrichedCard {
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
    foil: finish === 'foil',
    finish,
  };
}

function uploadResponse(cards: EnrichedCard[]): UploadResponse {
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: 'plain',
  };
}

function binder(): BinderDef {
  return {
    id: 'b1',
    name: 'Pinned',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [],
    pocketSize: null,
    doubleSided: false,
    fixedCapacity: null,
    color: '#000',
    createdAt: 1,
    updatedAt: 1,
  } as BinderDef;
}

beforeEach(async () => {
  await clearCollection();
  useDecksStore.setState({ decks: [], hydrated: true });
  useCollectionStore.setState({
    cards: [],
    binders: [],
    fileName: '',
    importHistory: [],
    uploadedAt: null,
    hydrating: false,
  });
});

describe('delete collection → re-upload same CSV (the persistence question)', () => {
  it('re-attaches a binder pin to the equivalent new copy after a delete + re-import', async () => {
    const store = useCollectionStore.getState();

    // 1. Import a collection and pin a card (mutator stamps the durable key).
    await store.importCards(
      uploadResponse([enriched('c1', 'sf1', 'nonfoil')]),
      'mine.csv',
      'replace'
    );
    useCollectionStore.setState({ binders: [binder()] });
    const pinned = useCollectionStore.getState().pinCardToBinder('b1', 'c1');
    expect(pinned).toBe(true);

    let b = useCollectionStore.getState().binders[0];
    expect(b.pinnedCopyIds).toEqual(['c1']);
    expect(b.pinnedKeys).toEqual(['sf1:nonfoil']); // durable shadow captured

    // 2. Delete the whole collection.
    await useCollectionStore.getState().clearCards();
    b = useCollectionStore.getState().binders[0];
    expect(useCollectionStore.getState().cards).toEqual([]);
    expect(b.pinnedCopyIds).toEqual([]); // live binding gone — card no longer owned
    expect(b.pinnedKeys).toEqual(['sf1:nonfoil']); // intent RETAINED through delete

    // 3. Re-upload the SAME CSV — backend mints a brand-new copyId.
    await useCollectionStore
      .getState()
      .importCards(uploadResponse([enriched('c2-fresh', 'sf1', 'nonfoil')]), 'mine.csv', 'replace');

    b = useCollectionStore.getState().binders[0];
    const cards = useCollectionStore.getState().cards;
    expect(cards.map((c) => c.copyId)).toEqual(['c2-fresh']);
    // The pin re-attached automatically to the equivalent new copy.
    expect(b.pinnedCopyIds).toEqual(['c2-fresh']);
    expect(b.pinnedKeys).toEqual(['sf1:nonfoil']);
  });

  it('restores a hand-arranged binder order after a delete + re-import', async () => {
    const store = useCollectionStore.getState();

    // 1. Import two printings and hand-order them B-before-A.
    await store.importCards(
      uploadResponse([enriched('a1', 'sf1', 'nonfoil'), enriched('b1', 'sf2', 'nonfoil')]),
      'mine.csv',
      'replace'
    );
    useCollectionStore.setState({ binders: [binder()] });
    useCollectionStore.getState().setBinderManualOrder('b1', ['b1', 'a1']);

    let b = useCollectionStore.getState().binders[0];
    expect(b.manualOrder).toEqual(['b1', 'a1']);
    expect(b.manualKeys).toEqual(['sf2:nonfoil', 'sf1:nonfoil']); // durable order shadow

    // 2. Delete the whole collection — live order gone, intent retained.
    await useCollectionStore.getState().clearCards();
    b = useCollectionStore.getState().binders[0];
    expect(b.manualOrder).toEqual([]);
    expect(b.manualKeys).toEqual(['sf2:nonfoil', 'sf1:nonfoil']);

    // 3. Re-upload the SAME CSV (collection lists A before B, fresh copyIds).
    await useCollectionStore
      .getState()
      .importCards(
        uploadResponse([
          enriched('a2-fresh', 'sf1', 'nonfoil'),
          enriched('b2-fresh', 'sf2', 'nonfoil'),
        ]),
        'mine.csv',
        'replace'
      );

    b = useCollectionStore.getState().binders[0];
    // The user's B-before-A arrangement re-attached to the new copies.
    expect(b.manualOrder).toEqual(['b2-fresh', 'a2-fresh']);
    expect(b.manualKeys).toEqual(['sf2:nonfoil', 'sf1:nonfoil']);
  });

  it('re-attaches a deck allocation after the same delete + re-import (decks already self-heal)', async () => {
    const store = useCollectionStore.getState();
    await store.importCards(
      uploadResponse([enriched('c1', 'sf1', 'nonfoil')]),
      'mine.csv',
      'replace'
    );

    useDecksStore.setState({
      decks: [
        {
          id: 'd1',
          name: 'Deck',
          color: '#111',
          format: 'commander',
          createdAt: 1,
          updatedAt: 1,
          commander: null,
          partnerCommander: null,
          commanderAllocatedCopyId: null,
          partnerCommanderAllocatedCopyId: null,
          sideboard: [],
          cards: [
            {
              slotId: 's1',
              card: { name: 'Sol Ring', id: 'sf1' } as never,
              allocatedCopyId: 'c1',
              addedAt: 1,
            },
          ],
        } as never,
      ],
      hydrated: true,
    });

    await useCollectionStore.getState().clearCards();
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBeNull();

    await useCollectionStore
      .getState()
      .importCards(uploadResponse([enriched('c2-fresh', 'sf1', 'nonfoil')]), 'mine.csv', 'replace');

    // The deck slot re-bound to the new copy of the same card.
    expect(useDecksStore.getState().decks[0].cards[0].allocatedCopyId).toBe('c2-fresh');
  });
});
