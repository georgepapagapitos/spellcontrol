import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { OfflineCombo } from './types';

const combos: OfflineCombo[] = [];
vi.mock('./db', () => ({ getAllCombos: async () => combos }));

const { searchCombosLocal } = await import('./match-combos');

function combo(
  id: string,
  cards: [string, string][],
  over: Partial<OfflineCombo> = {}
): OfflineCombo {
  return {
    id,
    identity: 'b',
    produces: ['Infinite lifegain'],
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity: 100,
    legalities: { commander: 'legal' },
    cardCount: cards.length,
    bracket: null,
    cards: cards.map(([oracleId, cardName], i) => ({
      oracleId,
      cardName,
      quantity: 1,
      position: i,
    })),
    ...over,
  };
}

describe('searchCombosLocal (E216)', () => {
  beforeEach(() => {
    combos.length = 0;
  });

  it('finds combos the bucketed matcher can never surface — you own 1 of 3', async () => {
    // The regression this feature exists to prevent: matchCombosLocal only ever
    // returns own-everything / own-all-but-one, so a 1-of-3 combo has NO bucket
    // and is unreachable at any cap.
    combos.push(
      combo('c1', [
        ['o1', 'Thassa’s Oracle'],
        ['o2', 'Lab Man'],
        ['o3', 'Brainstorm'],
      ])
    );
    const res = await searchCombosLocal({ query: 'thassa', ownedOracleIds: ['o1'] });
    expect(res.total).toBe(1);
    expect(res.matches[0]!.missingOracleIds).toEqual(['o2', 'o3']);
  });

  it('orders closest-first, then by popularity', async () => {
    combos.push(
      combo('far', [
        ['a', 'Alpha'],
        ['b', 'Beta'],
        ['c', 'Gamma'],
      ])
    );
    combos.push(
      combo('near', [
        ['a', 'Alpha'],
        ['b', 'Beta'],
      ])
    );
    combos.push(combo('done', [['a', 'Alpha']], { popularity: 5 }));
    const res = await searchCombosLocal({ query: 'alpha', ownedOracleIds: ['a'] });
    expect(res.matches.map((m) => m.combo.id)).toEqual(['done', 'near', 'far']);
  });

  it('matches result text too, so "infinite" style queries keep working', async () => {
    combos.push(combo('c1', [['o1', 'Nothing Relevant']], { produces: ['Infinite mana'] }));
    const res = await searchCombosLocal({ query: 'infinite mana', ownedOracleIds: [] });
    expect(res.total).toBe(1);
  });

  it('respects format legality and an empty query', async () => {
    combos.push(combo('c1', [['o1', 'Alpha']], { legalities: { commander: 'not_legal' } }));
    expect(
      (await searchCombosLocal({ query: 'alpha', ownedOracleIds: [], format: 'commander' })).total
    ).toBe(0);
    expect((await searchCombosLocal({ query: '  ', ownedOracleIds: [] })).total).toBe(0);
  });

  it('reports the true total even when the returned slice is capped', async () => {
    for (let i = 0; i < 250; i++) combos.push(combo(`c${i}`, [[`o${i}`, `Alpha ${i}`]]));
    const res = await searchCombosLocal({ query: 'alpha', ownedOracleIds: [] });
    expect(res.total).toBe(250);
    expect(res.matches).toHaveLength(200);
  });
});
