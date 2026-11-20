import { describe, expect, it } from 'vitest';
import {
  checkBuildFeasibility,
  describeBuildShortfall,
  nonlandSlots,
  usableOwnedCount,
} from './build-feasibility';

const owned = (n: number, colors: string[] = ['U'], typeLine = 'Instant') =>
  Array.from({ length: n }, (_, i) => ({
    name: `${typeLine} ${colors.join('')} ${i}`,
    colorIdentity: colors,
    typeLine,
  }));
const scopeOf = (cards: { name: string }[]) => new Set(cards.map((c) => c.name));
const base = {
  deckFormat: 99,
  landCount: 35,
  collectionMode: true,
  collectionStrategy: 'full' as const,
  collectionOwnedPercent: 75,
};
const check = (
  collection: ReturnType<typeof owned>,
  cz: Partial<typeof base> | { collectionStrategy: string } = {},
  scope: Set<string> | undefined = scopeOf(collection)
) =>
  checkBuildFeasibility({
    customization: { ...base, ...cz } as typeof base,
    hasPartner: false,
    colorIdentity: ['U'],
    commanderNames: ['Talrand, Sky Summoner'],
    collection,
    scope,
  });

describe('nonlandSlots', () => {
  it('counts the cards besides commanders and lands', () => {
    expect(nonlandSlots({ deckFormat: 99, landCount: 35 }, false)).toBe(64);
    expect(nonlandSlots({ deckFormat: 99, landCount: 35 }, true)).toBe(63);
    expect(nonlandSlots({ deckFormat: 60, landCount: 24 }, false)).toBe(35);
  });
});

describe('usableOwnedCount', () => {
  it('leaves out lands, off-color cards, the commander, repeats and names outside the scope', () => {
    const collection = [
      ...owned(3),
      ...owned(1), // a second copy of the first name
      ...owned(2, ['R']),
      ...owned(2, ['U'], 'Land'),
      { name: 'Island', colorIdentity: [], typeLine: 'Basic Land — Island' },
      { name: 'Talrand, Sky Summoner', colorIdentity: ['U'], typeLine: 'Legendary Creature' },
      { name: 'Held Elsewhere', colorIdentity: ['U'], typeLine: 'Instant' },
    ];
    const scope = scopeOf(collection);
    scope.delete('Held Elsewhere');
    expect(usableOwnedCount(collection, scope, ['U'], ['Talrand, Sky Summoner'])).toBe(3);
  });
});

describe('checkBuildFeasibility', () => {
  it('passes a build that reads no collection', () => {
    expect(check(owned(3), { collectionMode: false })).toBeNull();
    expect(
      checkBuildFeasibility({
        customization: base,
        hasPartner: false,
        colorIdentity: ['U'],
        commanderNames: [],
        collection: owned(3),
        scope: undefined,
      })
    ).toBeNull();
    expect(check(owned(3), { collectionStrategy: 'prefer' })).toBeNull();
    expect(check(owned(3), { collectionStrategy: 'exclude' })).toBeNull();
  });

  it('passes an owned-only build the collection covers', () => {
    expect(check(owned(64))).toBeNull();
  });

  it('reports an owned-only build the collection cannot cover', () => {
    expect(check(owned(41))).toEqual({ kind: 'collection', have: 41, need: 64, freeOnly: false });
    expect(check(owned(41), { collectionStrategy: 'available' })).toEqual({
      kind: 'collection',
      have: 41,
      need: 64,
      freeOnly: true,
    });
  });

  it('holds an owned share to the share, not the whole deck', () => {
    expect(check(owned(48), { collectionStrategy: 'partial' })).toBeNull();
    expect(check(owned(47), { collectionStrategy: 'partial' })).toEqual({
      kind: 'share',
      have: 47,
      need: 48,
      percent: 75,
    });
  });

  it('rounds the share as the generator does', () => {
    // 64 slots at 61% is 39.04: the generator asks for 39, not 40.
    const cz = { collectionStrategy: 'partial', collectionOwnedPercent: 61 } as const;
    expect(check(owned(39), cz)).toBeNull();
    expect(check(owned(38), cz)).toMatchObject({ need: 39 });
  });

  it('reports owned cards that are all off-color', () => {
    expect(check(owned(200, ['R']))).toEqual({
      kind: 'collection',
      have: 0,
      need: 64,
      freeOnly: false,
    });
  });
});

describe('describeBuildShortfall', () => {
  it('says what a build would do, in two sentences', () => {
    expect(describeBuildShortfall({ kind: 'collection', have: 41, need: 64 })).toEqual({
      title: 'Build without enough owned cards?',
      body: 'You own 41 cards in this commander’s colors, and the deck needs 64 besides lands. Extra lands or cards you don’t own would fill the other 23.',
    });
    expect(
      describeBuildShortfall({ kind: 'collection', have: 1, need: 64, freeOnly: true }).body
    ).toBe(
      'You have 1 card in this commander’s colors outside your other decks, and the deck needs 64 besides lands. Extra lands or cards you don’t own would fill the other 63.'
    );
    expect(describeBuildShortfall({ kind: 'share', have: 47, need: 48, percent: 75 })).toEqual({
      title: 'Build below a 75% owned share?',
      body: 'You own 47 cards in this commander’s colors, and a 75% share needs 48. The deck would come out 1 card under the share you set.',
    });
  });
});
