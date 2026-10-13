import { describe, expect, it } from 'vitest';
import type { EnrichedCard } from '@/types/index';
import { PICK_COUNT, PICK_POOL_SIZE, pickPool, rankOwnedCommanders } from './owned-commander-picks';

function card(name: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: `copy_${name}`,
    name,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf_${name}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    ...extra,
  };
}

const legend = (name: string, edhrecRank?: number) =>
  card(name, {
    typeLine: 'Legendary Creature — Human',
    legalities: { commander: 'legal' },
    edhrecRank,
  });

/** Enough filler to clear MIN_COLLECTION_SIZE. */
const filler = Array.from({ length: 30 }, (_, i) => card(`Filler ${i}`));

describe('owned-commander-picks', () => {
  it('has nothing to score for a collection with no commander', async () => {
    const result = await rankOwnedCommanders(filler, async () => []);
    expect(result).toEqual({ status: 'empty' });
  });

  it('has nothing to score for a collection too small to rate', async () => {
    const result = await rankOwnedCommanders([legend('A')], async () => []);
    expect(result).toEqual({ status: 'empty' });
  });

  it('ranks by share of the staples owned and keeps the top three', async () => {
    const cards = [
      ...filler,
      legend('Low', 1),
      legend('High', 2),
      legend('Mid', 3),
      legend('Mid2', 4),
    ];
    const owned: Record<string, number> = { Low: 1, High: 9, Mid: 5, Mid2: 4 };
    const result = await rankOwnedCommanders(cards, async (name) =>
      // Ten staples; the player owns "Filler 0".. up to the first N.
      Array.from({ length: 10 }, (_, i) => ({
        name: i < owned[name] ? `Filler ${i}` : `Missing ${name} ${i}`,
        inclusion: 90 - i,
      }))
    );
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.picks).toHaveLength(PICK_COUNT);
    expect(result.picks.map((p) => p.card.name)).toEqual(['High', 'Mid', 'Mid2']);
    expect(result.picks[0].score.percent).toBe(90);
  });

  it('breaks a tie on the more popular commander', async () => {
    const cards = [...filler, legend('Rare', 900), legend('Popular', 5)];
    const result = await rankOwnedCommanders(cards, async () => [
      { name: 'Filler 0', inclusion: 80 },
    ]);
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.picks.map((p) => p.card.name)).toEqual(['Popular', 'Rare']);
  });

  it('reports an error when no commander could be scored', async () => {
    const cards = [...filler, legend('A', 1), legend('B', 2)];
    const result = await rankOwnedCommanders(cards, async () => {
      throw new Error('offline');
    });
    expect(result).toEqual({ status: 'error' });
  });

  it('still ranks the commanders that scored when another fetch fails', async () => {
    const cards = [...filler, legend('A', 1), legend('B', 2)];
    const result = await rankOwnedCommanders(cards, async (name) => {
      if (name === 'A') throw new Error('offline');
      return [{ name: 'Filler 0', inclusion: 70 }];
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.picks.map((p) => p.card.name)).toEqual(['B']);
  });

  it('scores at most the pool size, most popular first', () => {
    const cards = [
      ...filler,
      ...Array.from({ length: PICK_POOL_SIZE + 5 }, (_, i) => legend(`L${i}`, 100 - i)),
    ];
    const pool = pickPool(cards);
    expect(pool).toHaveLength(PICK_POOL_SIZE);
    expect(pool[0].name).toBe(`L${PICK_POOL_SIZE + 4}`);
  });
});
