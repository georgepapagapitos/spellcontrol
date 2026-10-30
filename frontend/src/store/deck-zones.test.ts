import { describe, it, expect, expectTypeOf, beforeEach, vi } from 'vitest';
import { collectAllocatedCopyIds } from '@spellcontrol/binder-routing';
import { buildAllocationMap, dedupeDeckAllocations } from '@/lib/collection/allocations-core';
import type { EnrichedCard } from '@/types/index';
import type { ScryfallCard } from '@/deck-builder/types';
import { DECK_SLOT_ZONES, type DeckZone } from './deck-zones';
import { useDecksStore, type Deck, type DeckCard } from './decks';
import { bindSlotCopy } from './deck-copy-claims';

// Guard for the zone list every copy-claim reader loops over. A zone left off
// a claim reader shows its copy as free, and another deck takes it: the bug
// the In the box zone was added to fix. These tests run every listed zone
// through each reader, so a new zone is covered once it is listed, and the
// type check below fails until it is.

vi.mock('@/lib/sync', () => ({ persistDecksState: vi.fn().mockResolvedValue(undefined) }));

/** The `Deck` fields that hold `DeckCard` slots. */
type SlotFields = {
  [K in keyof Deck]-?: NonNullable<Deck[K]> extends DeckCard[] ? K : never;
}[keyof Deck];

function slot(zone: DeckZone, copyId: string | null = `copy-${zone}`): DeckCard {
  return {
    slotId: `slot-${zone}`,
    card: { name: `Card ${zone}`, id: `sf-${zone}` } as ScryfallCard,
    allocatedCopyId: copyId,
  };
}

function deckWithEveryZone(id = 'd1'): Deck {
  const deck = {
    id,
    name: 'Every zone',
    source: 'manual',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
  } as Deck;
  for (const zone of DECK_SLOT_ZONES) deck[zone] = [slot(zone)];
  return deck;
}

function copy(zone: DeckZone): EnrichedCard {
  return {
    copyId: `copy-${zone}`,
    name: `Card ${zone}`,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `sf-${zone}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

beforeEach(() => {
  useDecksStore.setState({ decks: [], hydrated: true });
});

describe('DECK_SLOT_ZONES', () => {
  it('lists every DeckCard[] field on Deck', () => {
    expectTypeOf<SlotFields>().toEqualTypeOf<DeckZone>();
  });

  it.each(DECK_SLOT_ZONES)('%s claims its copy in the allocation map', (zone) => {
    expect(buildAllocationMap([deckWithEveryZone()], []).has(`copy-${zone}`)).toBe(true);
  });

  it.each(DECK_SLOT_ZONES)('%s claims its copy in the server claim list', (zone) => {
    expect(collectAllocatedCopyIds([deckWithEveryZone()], []).has(`copy-${zone}`)).toBe(true);
  });

  it.each(DECK_SLOT_ZONES)('%s loses a copy another deck already claims', (zone) => {
    const { decks } = dedupeDeckAllocations([deckWithEveryZone('d1'), deckWithEveryZone('d2')]);
    expect(decks[0][zone]![0].allocatedCopyId).toBe(`copy-${zone}`);
    expect(decks[1][zone]![0].allocatedCopyId).toBeNull();
  });

  it.each(DECK_SLOT_ZONES)('%s keeps and refills its copy on remap', (zone) => {
    const deck = deckWithEveryZone();
    deck[zone] = [slot(zone, null)];
    useDecksStore.setState({ decks: [deck] });
    useDecksStore.getState().remapAllocations(DECK_SLOT_ZONES.map(copy), []);
    const after = useDecksStore.getState().decks[0];
    for (const z of DECK_SLOT_ZONES) expect(after[z]![0].allocatedCopyId).toBe(`copy-${z}`);
  });

  it.each(DECK_SLOT_ZONES)('%s takes a copy bound by slot id', (zone) => {
    const deck = deckWithEveryZone();
    deck[zone] = [slot(zone, null)];
    expect(bindSlotCopy(deck, `slot-${zone}`, 'bound')[zone]![0].allocatedCopyId).toBe('bound');
  });
});
