// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ownershipIndex } from './shared';
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
