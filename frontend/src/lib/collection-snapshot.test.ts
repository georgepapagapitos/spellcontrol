import { describe, it, expect } from 'vitest';
import {
  captureCollectionSnapshot,
  snapshotHasContent,
  type CollectionSnapshot,
} from './collection-snapshot';
import type { EnrichedCard, ListDef } from '../types';

function card(copyId: string): EnrichedCard {
  return {
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
    copyId,
    scryfallId: 'sf-1',
  } as EnrichedCard;
}

function fullSnapshot(over: Partial<CollectionSnapshot> = {}): CollectionSnapshot {
  return {
    cards: [card('a')],
    fileName: 'box.csv',
    scryfallHits: 1,
    scryfallMisses: 0,
    uploadedAt: 123,
    unresolvedNames: ['Mystery Card'],
    detectedFormat: 'manabox',
    importHistory: [{ id: 'i1', name: 'box.csv', count: 1, format: 'manabox', addedAt: 123 }],
    lists: [],
    ...over,
  };
}

describe('captureCollectionSnapshot', () => {
  it('picks exactly the restorable fields from a superset state', () => {
    const state = {
      ...fullSnapshot(),
      // fields that exist on the full store but must NOT leak into a snapshot
      hydrating: false,
      isLoading: true,
      binders: [{ id: 'b1' }],
      search: 'sol',
      error: 'boom',
    } as unknown as CollectionSnapshot;

    const snap = captureCollectionSnapshot(state);

    expect(Object.keys(snap).sort()).toEqual(
      [
        'cards',
        'detectedFormat',
        'fileName',
        'importHistory',
        'lists',
        'scryfallHits',
        'scryfallMisses',
        'unresolvedNames',
        'uploadedAt',
      ].sort()
    );
    expect(snap).not.toHaveProperty('binders');
    expect(snap).not.toHaveProperty('error');
  });

  it('preserves field values and array references (point-in-time view)', () => {
    const original = fullSnapshot();
    const snap = captureCollectionSnapshot(original);

    expect(snap.fileName).toBe('box.csv');
    expect(snap.scryfallHits).toBe(1);
    expect(snap.uploadedAt).toBe(123);
    expect(snap.detectedFormat).toBe('manabox');
    // Same references — the store replaces arrays immutably, so holding the ref
    // is a valid snapshot and undo restores the exact prior arrays.
    expect(snap.cards).toBe(original.cards);
    expect(snap.importHistory).toBe(original.importHistory);
    expect(snap.lists).toBe(original.lists);
    expect(snap.unresolvedNames).toBe(original.unresolvedNames);
  });

  it('handles a null uploadedAt', () => {
    const snap = captureCollectionSnapshot(fullSnapshot({ uploadedAt: null }));
    expect(snap.uploadedAt).toBeNull();
  });
});

describe('snapshotHasContent', () => {
  it('is true when there are cards', () => {
    expect(snapshotHasContent(fullSnapshot({ cards: [card('a')] }))).toBe(true);
  });

  it('is true when there is import history but no cards', () => {
    expect(
      snapshotHasContent(
        fullSnapshot({
          cards: [],
          importHistory: [{ id: 'i', name: 'x', count: 0, format: '', addedAt: 1 }],
        })
      )
    ).toBe(true);
  });

  it('is true when there are lists but no cards or history', () => {
    const list: ListDef = {
      id: 'l1',
      name: 'Wishlist',
      entries: [],
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(snapshotHasContent(fullSnapshot({ cards: [], importHistory: [], lists: [list] }))).toBe(
      true
    );
  });

  it('is false for an empty collection', () => {
    expect(snapshotHasContent(fullSnapshot({ cards: [], importHistory: [], lists: [] }))).toBe(
      false
    );
  });
});
