import { describe, expect, it } from 'vitest';
import { makeDeckAllocationInfo, type AllocationInfo } from './allocations-core';
import { breakdownCopies, copiesIn, type BinderRef } from './copy-locations';

const burn = makeDeckAllocationInfo('d1', 'Mono-Red Burn', '#b3392f', 'Lightning Bolt');
const red: BinderRef = { id: 'b1', name: 'Red Spells', color: '#a8452a' };
const modern: BinderRef = { id: 'b2', name: 'Modern Staples', color: '#2f6f8f' };

describe('breakdownCopies', () => {
  it('puts each copy in one place, so the counts add up to the stack', () => {
    // The screenshot's stack: 1 in a deck, 3 across two binders, 1 in neither.
    // c1 is in the deck AND keeps its pocket in Red Spells; it counts once, for the deck.
    const allocations = new Map<string, AllocationInfo>([['c1', burn]]);
    const binderOf = new Map([
      ['c1', red],
      ['c2', red],
      ['c3', red],
      ['c4', modern],
    ]);
    const b = breakdownCopies(['c1', 'c2', 'c3', 'c4', 'c5'], allocations, binderOf);
    expect(b.places.map((p) => [p.kind, p.name, p.copyIds.length])).toEqual([
      ['deck', 'Mono-Red Burn', 1],
      ['binder', 'Red Spells', 2],
      ['binder', 'Modern Staples', 1],
    ]);
    expect(b.unplaced).toBe(1);
    expect(copiesIn(b, 'deck') + copiesIn(b, 'cube') + copiesIn(b, 'binder') + b.unplaced).toBe(
      b.total
    );
  });

  it('links a deck, a cube and a binder to their pages', () => {
    const cube: AllocationInfo = { ...burn, ownerKind: 'cube', ownerId: 'q1', ownerName: 'Pauper' };
    const b = breakdownCopies(
      ['c1', 'c2', 'c3'],
      new Map([
        ['c1', burn],
        ['c2', cube],
      ]),
      new Map([['c3', red]])
    );
    expect(b.places.map((p) => p.href)).toEqual([
      '/decks/d1',
      '/decks/cube/q1',
      '/collection/binders/b1',
    ]);
    expect(b.places[1].color).toBe('var(--cube-color)');
  });

  it('keeps a friend deck link as given', () => {
    const shared = { ...burn, href: '/u/friend/decks/d1' };
    const b = breakdownCopies(['c1'], new Map([['c1', shared]]), new Map());
    expect(b.places[0].href).toBe('/u/friend/decks/d1');
  });

  it('reports a stack in nothing as all unplaced', () => {
    expect(breakdownCopies(['c1', 'c2'], new Map(), new Map())).toEqual({
      total: 2,
      places: [],
      unplaced: 2,
    });
  });
});
