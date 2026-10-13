import { describe, expect, it } from 'vitest';
import { makeDeckAllocationInfo, type AllocationInfo } from './allocations-core';
import {
  breakdownCopies,
  copiesIn,
  describeCopyPlaces,
  listedNotHeld,
  markGroups,
  type BinderRef,
} from './copy-locations';

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

// The screenshot's stack again, as a fixture: 1 in a deck (its pocket in Red
// Spells), 2 more in Red Spells, 1 in Modern Staples, 1 in nothing.
const split = () =>
  breakdownCopies(
    ['c1', 'c2', 'c3', 'c4', 'c5'],
    new Map([['c1', burn]]),
    new Map([
      ['c1', red],
      ['c2', red],
      ['c3', red],
      ['c4', modern],
    ])
  );

describe('markGroups', () => {
  it('counts a mark that holds part of the stack, in copies', () => {
    expect(markGroups(split(), [])).toEqual([
      { kind: 'deck', color: '#b3392f', copies: 1, counted: true },
      // Two binders have no one color: the neutral mark.
      { kind: 'binder', color: undefined, copies: 3, counted: true },
    ]);
  });

  it('leaves a mark bare when it holds the whole stack', () => {
    const all = breakdownCopies(
      ['c1', 'c2', 'c3', 'c4'],
      new Map(),
      new Map([
        ['c1', red],
        ['c2', red],
        ['c3', red],
        ['c4', red],
      ])
    );
    expect(markGroups(all, [])).toEqual([
      { kind: 'binder', color: '#a8452a', copies: 4, counted: false },
    ]);
  });

  it('never counts a single copy', () => {
    const one = breakdownCopies(['c1'], new Map([['c1', burn]]), new Map());
    expect(markGroups(one, [])[0].counted).toBe(false);
  });

  it('counts two decks as copies, not as decks', () => {
    const korvold = makeDeckAllocationInfo('d2', 'Korvold', '#2f6f9f', 'Lightning Bolt');
    const b = breakdownCopies(
      ['c1', 'c2', 'c3', 'c4'],
      new Map([
        ['c1', burn],
        ['c2', burn],
        ['c3', korvold],
      ]),
      new Map()
    );
    expect(markGroups(b, [])).toEqual([
      { kind: 'deck', color: undefined, copies: 3, counted: true },
    ]);
  });

  it('draws only the kinds asked for', () => {
    expect(markGroups(split(), [], ['binder']).map((g) => g.kind)).toEqual(['binder']);
  });

  it('adds a listing only for a cube that holds no copy', () => {
    const cube: AllocationInfo = { ...burn, ownerKind: 'cube', ownerId: 'q1', ownerName: 'Pauper' };
    const held = breakdownCopies(['c1', 'c2'], new Map([['c1', cube]]), new Map());
    const listings = [
      { cubeId: 'q1', cubeName: 'Pauper' },
      { cubeId: 'q2', cubeName: 'Draft night' },
    ];
    expect(listedNotHeld(held, listings)).toEqual([{ cubeId: 'q2', cubeName: 'Draft night' }]);
    expect(markGroups(held, listings).map((g) => [g.kind, g.counted])).toEqual([
      ['cube', true],
      ['listed', false],
    ]);
  });
});

describe('describeCopyPlaces', () => {
  it('says every place and the copies in none, in one sentence', () => {
    expect(describeCopyPlaces(split(), [])).toBe(
      'Where your copies are: 1 in Mono-Red Burn, 2 in Red Spells, 1 in Modern Staples, 1 not in a deck or binder'
    );
  });

  it('names a listing and speaks of one copy in the singular', () => {
    const one = breakdownCopies(['c1'], new Map(), new Map([['c1', red]]));
    expect(describeCopyPlaces(one, [{ cubeId: 'q2', cubeName: 'Draft night' }])).toBe(
      'Where your copy is: 1 in Red Spells, listed in Draft night'
    );
  });
});
