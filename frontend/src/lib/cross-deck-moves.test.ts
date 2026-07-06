import { describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck, DeckCard } from '../store/decks';
import type { EnrichedCard } from '../types';
import { buildAllocationMap } from './allocations';

// Tagger data isn't loaded in the test env — mock it with a small fixture
// taxonomy, same pattern as substituteFinder.test.ts (roles are the 4
// functional keys `findOwnedSubstitute` matches on; independent of the
// synergy-axis oracle text below).
vi.mock('@/deck-builder/services/tagger/client', () => {
  const roles: Record<string, string[]> = {
    'Idle Cleric': ['ramp'],
    'Idle Cleric 2': ['ramp'],
    'Spare Rock': ['ramp'],
    'Off-Axis Rock': ['removal'],
  };
  return {
    getCardRole: (name: string) => roles[name]?.[0] ?? null,
    cardMatchesRole: (name: string, role: string) => (roles[name] ?? []).includes(role),
    getCardSubtype: () => null,
    getCardTags: (name: string) => roles[name] ?? [],
  };
});

import { findCrossDeckMoves } from './cross-deck-moves';

function card(name: string, over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: `o-${name}`,
    name,
    cmc: 2,
    type_line: 'Artifact',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...over,
  } as ScryfallCard;
}

function slot(c: ScryfallCard, copyId: string | null = `copy-${c.name}`): DeckCard {
  return { slotId: `slot-${c.name}`, card: c, allocatedCopyId: copyId };
}

function deck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    name: 'Test Deck',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    format: 'commander',
    generationContext: null,
    color: '#7a8a70',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

function owned(name: string, over: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: `free-${name}`,
    name,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: `sf-${name}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...over,
  };
}

// Three sac-outlet producers + two sacrifice-payoff cards = 5 total, crossing
// the synergy engine's INVEST_THRESHOLD — a deck genuinely built around
// sacrifice/aristocrats.
const sacCards = [
  slot(card('Outlet A', { oracle_text: 'Sacrifice a creature: Draw a card.' })),
  slot(card('Outlet B', { oracle_text: 'Sacrifice another creature: Gain 1 life.' })),
  slot(card('Outlet C', { oracle_text: 'Sacrifice a permanent: Add one mana.' })),
  slot(
    card('Reward A', {
      oracle_text: 'Whenever you sacrifice a creature, each opponent loses 1 life.',
    })
  ),
  slot(
    card('Reward B', { oracle_text: 'Whenever another creature you control dies, draw a card.' })
  ),
];

// Three lifegain producers + two lifegain-payoff cards = 5 total — a deck
// genuinely built around lifegain, untouched by the sacrifice deck above.
const lifegainCards = [
  slot(card('Gainer A', { oracle_text: 'You gain 3 life.' })),
  slot(card('Gainer B', { oracle_text: 'You gain 3 life.' })),
  slot(card('Gainer C', { oracle_text: 'You gain 3 life.' })),
  slot(card('Payoff A', { oracle_text: 'Whenever you gain life, draw a card.' })),
  slot(card('Payoff B', { oracle_text: 'Whenever you gain life, create a 1/1 token.' })),
];

// The candidate: a lifegain producer (matches the target deck's engine) that
// does nothing for sacrifice (the donor's engine) — and is tagged 'ramp' so
// `findOwnedSubstitute` has a role to match a replacement against. Real cards
// often span both an axis and a role independently (e.g. Smothering Tithe is
// 'ramp'-role and touches the treasure/tokens axis); this fixture mirrors that.
const idleCard = card('Idle Cleric', { oracle_text: 'You gain 3 life.', cmc: 2 });

function buildScene(overrides: { candidateColor?: string[]; targetColor?: string[] } = {}) {
  const candidate = { ...idleCard, color_identity: overrides.candidateColor ?? [] };
  const donor = deck({
    id: 'donor',
    name: 'Aristocrats',
    cards: [...sacCards, slot(candidate)],
  });
  const target = deck({
    id: 'target',
    name: 'Lifegain',
    commander: overrides.targetColor
      ? card('Target Commander', {
          color_identity: overrides.targetColor,
          type_line: 'Legendary Creature — Test',
        })
      : null,
    cards: lifegainCards,
  });
  return { donor, target };
}

describe('findCrossDeckMoves', () => {
  it('suggests moving a card that is idle in its own deck but feeds a sibling engine, with a replacement', () => {
    const { donor, target } = buildScene();
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);

    expect(moves).toHaveLength(1);
    const m = moves[0];
    expect(m.cardName).toBe('Idle Cleric');
    expect(m.fromDeckId).toBe('donor');
    expect(m.toDeckId).toBe('target');
    expect(m.fitGain).toBeGreaterThanOrEqual(1);
    expect(m.replacementName).toBe('Spare Rock');
    expect(m.cardCopyId).toBe('copy-Idle Cleric');
    expect(m.whyMove.length).toBeGreaterThan(0);
    expect(m.whyReplacement.length).toBeGreaterThan(0);
  });

  it('never crosses color identity — a card outside the target deck stays put', () => {
    const { donor, target } = buildScene({ candidateColor: ['R'], targetColor: ['U', 'B'] });
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('skips a card that already pulls weight in its own deck', () => {
    // A sac-outlet card sitting in the sacrifice deck reinforces it directly —
    // never a donation candidate, regardless of what a sibling deck wants.
    const donor = deck({ id: 'donor', name: 'Aristocrats', cards: sacCards });
    const target = deck({ id: 'target', name: 'Lifegain', cards: lifegainCards });
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('skips when a free unallocated copy already exists (gap analysis territory, not a move)', () => {
    const { donor, target } = buildScene();
    const decks = [donor, target];
    // A second, unallocated "Idle Cleric" — the target deck can just claim it.
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 }), owned('Idle Cleric')];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('skips when no owned replacement can patch the donor deck', () => {
    const { donor, target } = buildScene();
    const decks = [donor, target];
    const collection: EnrichedCard[] = []; // nothing owned to patch the hole

    const allocations = buildAllocationMap(decks);
    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('skips an unbound slot — nothing physical to move', () => {
    const candidate = { ...idleCard };
    const donor = deck({
      id: 'donor',
      name: 'Aristocrats',
      cards: [...sacCards, slot(candidate, null)], // no allocatedCopyId
    });
    const target = deck({ id: 'target', name: 'Lifegain', cards: lifegainCards });
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('ignores lands entirely', () => {
    const landCard = card('Idle Swamp', {
      type_line: 'Basic Land — Swamp',
      oracle_text: '{T}: Add {B}.',
      cmc: 0,
    });
    const donor = deck({ id: 'donor', name: 'Aristocrats', cards: [...sacCards, slot(landCard)] });
    const target = deck({ id: 'target', name: 'Lifegain', cards: lifegainCards });
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(0);
  });

  it('returns nothing with fewer than two decks', () => {
    const { donor } = buildScene();
    const moves = findCrossDeckMoves([donor], [], new Map());
    expect(moves).toHaveLength(0);
  });

  it('never offers the same replacement to two different suggestions', () => {
    // A second donor deck with its own idle lifegain-producer card, competing
    // for the same single spare "Spare Rock".
    const { donor, target } = buildScene();
    const idleCard2 = card('Idle Cleric 2', { oracle_text: 'You gain 3 life.', cmc: 2 });
    const donor2 = deck({
      id: 'donor2',
      name: 'Aristocrats II',
      cards: [...sacCards.map((s) => ({ ...s, slotId: `${s.slotId}-2` })), slot(idleCard2)],
    });
    const decks = [donor, donor2, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })]; // only ONE spare
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(1);
    expect(moves[0].replacementName).toBe('Spare Rock');
  });

  it('collapses a multi-copy donor into one suggestion per card+target', () => {
    const { donor, target } = buildScene();
    // A second sleeved copy of the same card in the same (non-singleton) donor.
    donor.cards.push({
      slotId: 'slot-Idle Cleric-b',
      card: idleCard,
      allocatedCopyId: 'copy-Idle Cleric-b',
    });
    const decks = [donor, target];
    // TWO viable ramp replacements — without the dedupe the duplicate
    // suggestion would eat the second one from the claim pool.
    const collection: EnrichedCard[] = [
      owned('Spare Rock', { cmc: 2 }),
      owned('Idle Cleric 2', { cmc: 2 }),
    ];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations);
    expect(moves).toHaveLength(1);
    expect(moves[0].cardName).toBe('Idle Cleric');
  });

  it('respects the limit option', () => {
    const { donor, target } = buildScene();
    const decks = [donor, target];
    const collection: EnrichedCard[] = [owned('Spare Rock', { cmc: 2 })];
    const allocations = buildAllocationMap(decks);

    const moves = findCrossDeckMoves(decks, collection, allocations, { limit: 0 });
    expect(moves).toHaveLength(0);
  });
});
