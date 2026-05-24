// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { saveCollection, loadCollection, clearCollection } from './local-cards';

describe('local-cards', () => {
  it('returns null before anything is saved', async () => {
    await clearCollection();
    expect(await loadCollection()).toBeNull();
  });

  it('round-trips a saved collection', async () => {
    const data = {
      fileName: 'cards.csv',
      cards: [
        {
          copyId: 'c1',
          name: 'Sol Ring',
          setCode: 'CMR',
          setName: 'Commander Legends',
          collectorNumber: '1',
          rarity: 'uncommon',
          scryfallId: 'sf-1',
          purchasePrice: 1,
          sourceCategory: '',
          sourceFormat: 'plain',
          foil: false,
          finish: 'nonfoil' as const,
        },
      ],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 1700000000000,
      importHistory: [],
      lists: [],
    };
    await saveCollection(data);
    const loaded = await loadCollection();
    expect(loaded?.fileName).toBe('cards.csv');
    expect(loaded?.cards).toHaveLength(1);
    expect(loaded?.cards[0].copyId).toBe('c1');
  });

  it('clearCollection wipes the stored payload', async () => {
    await saveCollection({
      fileName: 'x',
      cards: [],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 0,
      importHistory: [],
      lists: [],
    });
    await clearCollection();
    expect(await loadCollection()).toBeNull();
  });
});
