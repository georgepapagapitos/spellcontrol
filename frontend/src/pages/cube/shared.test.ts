// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ownershipIndex, countEligibleLegends } from './shared';
import type { AllocationInfo } from '@/lib/allocations';
import type { EnrichedCard } from '@/types';

const copy = (copyId: string, name: string) => ({ copyId, name }) as EnrichedCard;
const claim = (ownerKind: 'deck' | 'cube', ownerId: string, cardName: string): AllocationInfo => ({
  ownerKind,
  ownerId,
  ownerName: ownerId,
  ownerColor: '',
  deckId: ownerKind === 'deck' ? ownerId : '',
  deckName: ownerId,
  deckColor: '',
  cardName,
});

describe('ownershipIndex', () => {
  const cards = [copy('c1', 'Swords to Plowshares'), copy('c2', 'Swords to Plowshares')];

  it('a free copy means owned and no badge, regardless of other copies', () => {
    const allocs = new Map([['c1', claim('deck', 'deck-a', 'Swords to Plowshares')]]);
    const { ownershipFor, committedFor } = ownershipIndex(cards, allocs);
    expect(ownershipFor('Swords to Plowshares')).toBe('owned');
    expect(committedFor('Swords to Plowshares')).toEqual([]);
  });

  it('every copy committed → badged with each distinct owner, deck naming the label', () => {
    const allocs = new Map([
      ['c1', claim('cube', 'cube-x', 'Swords to Plowshares')],
      ['c2', claim('deck', 'deck-a', 'Swords to Plowshares')],
    ]);
    const { ownershipFor, committedFor } = ownershipIndex(cards, allocs);
    expect(ownershipFor('swords to plowshares')).toBe('in-other-deck');
    expect(committedFor('Swords to Plowshares').map((a) => a.ownerId)).toEqual([
      'cube-x',
      'deck-a',
    ]);
  });

  it('the cube on screen never badges its own reserved copies', () => {
    // Guard for the "all 180 cards say In a cube" regression: a loaded
    // physical cube holds every one of its picks, so without the exclusion
    // the whole gallery badges itself.
    const allocs = new Map([
      ['c1', claim('cube', 'cube-x', 'Swords to Plowshares')],
      ['c2', claim('cube', 'cube-x', 'Swords to Plowshares')],
    ]);
    const elsewhere = ownershipIndex(cards, allocs);
    expect(elsewhere.ownershipFor('Swords to Plowshares')).toBe('in-cube');
    expect(elsewhere.committedFor('Swords to Plowshares')).toHaveLength(1);

    const viewing = ownershipIndex(cards, allocs, 'cube-x');
    expect(viewing.ownershipFor('Swords to Plowshares')).toBe('owned');
    expect(viewing.committedFor('Swords to Plowshares')).toEqual([]);
    // …but a DIFFERENT cube's hold still shows.
    const other = ownershipIndex(cards, allocs, 'cube-y');
    expect(other.ownershipFor('Swords to Plowshares')).toBe('in-cube');
  });

  it('unknown name is unowned', () => {
    expect(ownershipIndex(cards, new Map()).ownershipFor('Ghost')).toBe('unowned');
  });
});

describe('countEligibleLegends (board #12, PR2)', () => {
  const row = (name: string, over: Partial<EnrichedCard> = {}): EnrichedCard =>
    ({ copyId: name, name, ...over }) as EnrichedCard;

  it('counts legendary creatures and the oracle-text "can be your commander" pattern, nothing else', () => {
    const collection = [
      row('Meren of Clan Nel Toth', { typeLine: 'Legendary Creature — Human Shaman' }),
      row('Sol Ring', { typeLine: 'Artifact' }),
      row('Daretti, Scrap Savant', {
        typeLine: 'Legendary Planeswalker — Daretti',
        oracleText: 'Daretti, Scrap Savant can be your commander.',
      }),
      row('Jace, the Mind Sculptor', { typeLine: 'Legendary Planeswalker — Jace' }),
    ];
    const names = collection.map((c) => c.name);
    expect(countEligibleLegends(names, collection)).toBe(2);
  });

  it('only counts names actually in the filtered list, and dedupes by name', () => {
    const collection = [
      row('Selvala, Heart of the Wild', { typeLine: 'Legendary Creature — Elf Druid' }),
      row('Selvala, Heart of the Wild', { typeLine: 'Legendary Creature — Elf Druid' }),
    ];
    expect(countEligibleLegends(['Selvala, Heart of the Wild'], collection)).toBe(1);
    expect(countEligibleLegends([], collection)).toBe(0);
  });
});
