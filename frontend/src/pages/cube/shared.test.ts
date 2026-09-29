// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ownershipIndex, countEligibleLegends, pickToPreviewCard, pickThumb } from './shared';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { EnrichedCard } from '@/types';
import type { ScryfallCard } from '@/deck-builder/types';

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

// The cube once drew every card's art from a by-NAME Scryfall lookup, i.e.
// Scryfall's default printing, so a user who owns the 2XM Swords saw some
// other set's Swords. These pin that an owned pick resolves to the user's copy.
describe('copyFor: the printing the cube shows', () => {
  const printing = (copyId: string, set: string, over: Partial<EnrichedCard> = {}): EnrichedCard =>
    ({
      copyId,
      name: 'Swords to Plowshares',
      setCode: set,
      scryfallId: `sf-${set}`,
      imageSmall: `https://img/${set}.jpg`,
      finish: 'nonfoil',
      purchasePrice: 1,
      ...over,
    }) as EnrichedCard;
  const defaultPrinting = {
    name: 'Swords to Plowshares',
    image_uris: { small: 'https://img/scryfall-default.jpg' },
  } as unknown as ScryfallCard;
  const enriched = new Map([['Swords to Plowshares', defaultPrinting]]);

  it('an owned pick previews and thumbs the owned printing, not the default', () => {
    const { copyFor } = ownershipIndex([printing('a', '2xm')], new Map());
    const card = pickToPreviewCard({ name: 'Swords to Plowshares' }, enriched, copyFor);
    expect(card.setCode).toBe('2xm');
    expect(card.copyId).toBe('a');
    expect(pickThumb('Swords to Plowshares', enriched, copyFor)).toBe('https://img/2xm.jpg');
  });

  it('an unowned pick (a friend supplies it) falls back to the default printing', () => {
    const { copyFor } = ownershipIndex([], new Map());
    expect(pickThumb('Swords to Plowshares', enriched, copyFor)).toBe(
      'https://img/scryfall-default.jpg'
    );
  });

  it("the copy the viewed cube holds wins over a copy that's merely free", () => {
    const owned = [printing('cheap', 'ema', { purchasePrice: 0.5 }), printing('held', 'ice')];
    const allocs = new Map([['held', claim('cube', 'cube-x', 'Swords to Plowshares')]]);
    expect(ownershipIndex(owned, allocs, 'cube-x').copyFor('Swords to Plowshares')?.copyId).toBe(
      'held'
    );
    // Viewed from elsewhere, that copy is someone else's: the free one shows.
    expect(ownershipIndex(owned, allocs).copyFor('Swords to Plowshares')?.copyId).toBe('cheap');
  });

  it('a free copy beats one a deck holds, and ranks like the allocator (real, nonfoil)', () => {
    const owned = [
      printing('in-deck', 'm10'),
      printing('proxy', 'prx', { proxy: true, purchasePrice: 0 }),
      printing('foil', 'a25', { finish: 'foil' }),
      printing('plain', 'mh3'),
    ];
    const allocs = new Map([['in-deck', claim('deck', 'deck-a', 'Swords to Plowshares')]]);
    expect(ownershipIndex(owned, allocs).copyFor('Swords to Plowshares')?.copyId).toBe('plain');
  });

  it('every copy held elsewhere still shows a printing you own', () => {
    const allocs = new Map([['a', claim('deck', 'deck-a', 'Swords to Plowshares')]]);
    expect(
      ownershipIndex([printing('a', '2xm')], allocs).copyFor('swords to plowshares')?.setCode
    ).toBe('2xm');
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
