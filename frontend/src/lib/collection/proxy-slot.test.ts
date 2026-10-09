import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '@/store/decks';
import type { EnrichedCard } from '@/types/index';
import { findWaitingSlot, listContestedCards } from './allocations';
import { computeCloseToDone, computeSharedCopies } from './collection-insights';

// A deck slot marked as a proxy wants no physical copy. These are the readers
// that would otherwise count it as a deck waiting on one.

const DRYAD = 'Dryad of the Ilysian Grove';

const copy = (over: Partial<EnrichedCard> = {}): EnrichedCard => ({
  copyId: 'dryad-thb',
  name: DRYAD,
  setCode: 'THB',
  setName: 'Theros Beyond Death',
  collectorNumber: '169',
  rarity: 'mythic',
  scryfallId: 'sf-thb',
  purchasePrice: 1,
  sourceCategory: '',
  sourceFormat: 'plain',
  foil: false,
  finish: 'nonfoil',
  ...over,
});

const slot = (
  slotId: string,
  allocatedCopyId: string | null,
  extra: Partial<DeckCard> = {},
  scryfallId = 'sf-thb'
): DeckCard => ({
  slotId,
  card: { name: DRYAD, id: scryfallId, prices: {} } as ScryfallCard,
  allocatedCopyId,
  ...extra,
});

const deck = (id: string, cards: DeckCard[]): Deck => ({
  id,
  name: `Deck ${id}`,
  source: 'manual',
  format: 'commander',
  commander: null,
  partnerCommander: null,
  commanderAllocatedCopyId: null,
  partnerCommanderAllocatedCopyId: null,
  cards,
  sideboard: [],
  considering: [],
  generationContext: null,
  color: '#7a8a70',
  createdAt: 0,
  updatedAt: 0,
});

describe('findWaitingSlot', () => {
  it('finds the other deck listing the card with no copy, printing match first', () => {
    const decks = [
      deck('self', [slot('mine', 'dryad-thb')]),
      deck('a', [slot('a1', null, {}, 'sf-other')]),
      deck('b', [slot('b1', null)]),
    ];
    expect(findWaitingSlot(copy(), decks, 'self')).toEqual({
      deckId: 'b',
      deckName: 'Deck b',
      slotId: 'b1',
    });
    expect(findWaitingSlot(copy(), decks.slice(0, 2), 'self')?.slotId).toBe('a1');
  });

  it('skips proxy slots, bound slots and the deck letting the copy go', () => {
    const decks = [
      deck('self', [slot('mine', null)]),
      deck('a', [slot('a1', null, { proxy: true })]),
      deck('b', [slot('b1', 'other-copy')]),
    ];
    expect(findWaitingSlot(copy(), decks, 'self')).toBeNull();
  });
});

describe('proxy slots want no copy', () => {
  const decks = [
    deck('real', [slot('r', 'dryad-thb')]),
    deck('proxied', [slot('p', null, { proxy: true })]),
  ];

  it('are not contested in the Shared copies review', () => {
    expect(listContestedCards(decks[1], [copy()], decks, [])).toEqual([]);
    const unmarked = deck('proxied', [slot('p', null)]);
    expect(listContestedCards(unmarked, [copy()], [decks[0], unmarked], [])).toHaveLength(1);
  });

  it('add no demand to shared copies', () => {
    expect(computeSharedCopies([copy()], decks, [])).toEqual([]);
  });

  it('count as covered for close to done', () => {
    const unowned = [deck('x', [slot('p', null, { proxy: true })])];
    expect(computeCloseToDone(unowned, new Set(), 'USD')).toEqual([]);
  });
});
