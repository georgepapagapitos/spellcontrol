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
    };
    await saveCollection(data);
    const loaded = await loadCollection();
    expect(loaded?.fileName).toBe('cards.csv');
    expect(loaded?.cards).toHaveLength(1);
    expect(loaded?.cards[0].copyId).toBe('c1');
  });

  it('migrates legacy binderName to sourceCategory and stamps sourceFormat', async () => {
    await saveCollection({
      fileName: 'old.csv',
      cards: [
        {
          copyId: 'c2',
          name: 'X',
          setCode: 'A',
          setName: 'A',
          collectorNumber: '1',
          rarity: 'common',
          scryfallId: 'a',
          purchasePrice: 0,
          binderName: 'My binder',
          foil: false,
          finish: 'nonfoil' as const,
        } as never,
      ],
      scryfallHits: 1,
      scryfallMisses: 0,
      uploadedAt: 0,
    });
    const loaded = await loadCollection();
    const c = loaded!.cards[0] as unknown as Record<string, unknown>;
    expect(c.sourceCategory).toBe('My binder');
    expect(c.binderName).toBeUndefined();
    expect(c.sourceFormat).toBe('manabox');
  });

  it('clearCollection wipes the stored payload', async () => {
    await saveCollection({
      fileName: 'x',
      cards: [],
      scryfallHits: 0,
      scryfallMisses: 0,
      uploadedAt: 0,
    });
    await clearCollection();
    expect(await loadCollection()).toBeNull();
  });
});
