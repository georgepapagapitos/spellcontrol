import { describe, expect, it } from 'vitest';
import { makeDeckAllocationInfo, type AllocationInfo } from '@/lib/collection/allocations-core';
import { buildOwnedBrowser, describeOwned, givePriority, giveWarning } from './owned-to-browser';
import type { EnrichedCard } from '../../types';

function owned(copyId: string, name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId,
    name,
    oracleId: `o-${name}`,
    scryfallId: `sf-${name}`,
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'rare',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

const deckClaim = (name: string): AllocationInfo =>
  makeDeckAllocationInfo(`id-${name}`, name, '#fff', 'x');

describe('buildOwnedBrowser', () => {
  const cards = [
    owned('a1', 'Counterspell'),
    owned('a2', 'Counterspell'),
    owned('t1', 'Ancient Tomb'),
    owned('r1', 'Rhystic Study'),
    owned('p1', 'Proxy Card', { proxy: true }),
    owned('n1', 'No Oracle', { oracleId: undefined }),
  ];
  const model = buildOwnedBrowser(cards, new Map([['r1', deckClaim('Esper Tempo')]]));

  it('leaves out what a trade cannot move', () => {
    expect(model.rows.map((r) => r.name)).toEqual([
      'Counterspell',
      'Counterspell',
      'Ancient Tomb',
      'Rhystic Study',
    ]);
    expect(model.info.has('o-Proxy Card')).toBe(false);
  });

  it('flags each copy as spare and in a deck for the browser chips', () => {
    const counters = model.rows.filter((r) => r.name === 'Counterspell');
    expect(counters.filter((r) => r.spare)).toHaveLength(1);
    expect(model.rows.find((r) => r.name === 'Rhystic Study')?.inDeck).toBe(true);
    expect(model.rows.find((r) => r.name === 'Ancient Tomb')?.inDeck).toBe(false);
  });

  it('describes each card by what giving it costs', () => {
    expect(describeOwned(model.info.get('o-Counterspell')!)).toBe('1 spare');
    expect(describeOwned(model.info.get('o-Ancient Tomb')!)).toBe('your only copy');
    expect(describeOwned(model.info.get('o-Rhystic Study')!)).toBe('in 1 deck');
  });

  it('counts decks, not copies, and names the holders', () => {
    const two = buildOwnedBrowser(
      [owned('x1', 'Sol Ring'), owned('x2', 'Sol Ring')],
      new Map([
        ['x1', deckClaim('Deck A')],
        ['x2', deckClaim('Deck B')],
      ])
    );
    const info = two.info.get('o-Sol Ring')!;
    expect(info.holders).toEqual(['Deck A', 'Deck B']);
    expect(describeOwned(info)).toBe('in 2 decks');
  });
});

describe('givePriority', () => {
  it('ranks wanted spares, wanted, spares, then the rest', () => {
    expect(givePriority(true, true)).toBeLessThan(givePriority(true, false));
    expect(givePriority(true, false)).toBeLessThan(givePriority(false, true));
    expect(givePriority(false, true)).toBeLessThan(givePriority(false, false));
  });
});

describe('giveWarning', () => {
  const tomb = owned('t1', 'Ancient Tomb');
  const rhystic = owned('r1', 'Rhystic Study');
  const allocations = new Map([['r1', deckClaim('Esper Tempo')]]);
  const model = buildOwnedBrowser(
    [tomb, rhystic, owned('c1', 'Cultivate'), owned('c2', 'Cultivate')],
    allocations
  );

  it('names the deck that holds the copy', () => {
    expect(giveWarning(rhystic, model.info.get('o-Rhystic Study')!, allocations, 'Morgan')).toBe(
      'Rhystic Study is in Esper Tempo. If Morgan accepts, that deck will need another copy.'
    );
  });

  it('warns about an only copy', () => {
    expect(giveWarning(tomb, model.info.get('o-Ancient Tomb')!, allocations, 'Morgan')).toBe(
      "Ancient Tomb is your only copy. If Morgan accepts, you won't have it any more."
    );
  });

  it('says nothing about a free copy', () => {
    expect(
      giveWarning(owned('c2', 'Cultivate'), model.info.get('o-Cultivate')!, allocations, 'Morgan')
    ).toBeNull();
  });
});
