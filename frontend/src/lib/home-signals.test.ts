import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Deck } from '../store/decks';
import type { GameNight } from './game-nights-api';
import type { BinderDef, EnrichedCard } from '../types';
import { materializeBinders } from './materialize';
import { printingFinishKey } from './collection-mutations';
import type { ArrivalCandidateCard, NewArrivalsInput } from './new-arrivals';
import {
  hasNewArrivals,
  aggregateNewArrivalDecks,
  aggregateBinderReviewCount,
  upcomingGameNights,
} from './home-signals';

// ── Shared fixtures (mirrors new-arrivals.test.ts's builders) ──────────────
function card(overrides: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: overrides.name,
    oracle_id: overrides.name,
    cmc: 2,
    type_line: 'Creature — Human',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test Set',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function candidate(
  overrides: Partial<ArrivalCandidateCard> & { name: string }
): ArrivalCandidateCard {
  return {
    typeLine: 'Creature — Human',
    cmc: 2,
    colorIdentity: [],
    ...overrides,
  };
}

const BASE_TIME = 1_000_000;

function baseInput(overrides: Partial<NewArrivalsInput> = {}): NewArrivalsInput {
  return {
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    deckUpdatedAt: BASE_TIME,
    lastArrivalReviewAt: undefined,
    collectionCards: [],
    addedAtByImportId: new Map(),
    ...overrides,
  };
}

let deckIdCounter = 0;
function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: `deck-${deckIdCounter++}`,
    name: 'Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Deck;
}

describe('hasNewArrivals', () => {
  it('returns false for a candidate acquired before the window', () => {
    expect(
      hasNewArrivals(
        baseInput({ collectionCards: [candidate({ name: 'Old', updatedAt: BASE_TIME - 1000 })] })
      )
    ).toBe(false);
  });

  it('returns true for a candidate acquired after the window', () => {
    expect(
      hasNewArrivals(
        baseInput({ collectionCards: [candidate({ name: 'New', updatedAt: BASE_TIME + 1000 })] })
      )
    ).toBe(true);
  });

  it('excludes basic lands', () => {
    expect(
      hasNewArrivals(
        baseInput({
          collectionCards: [
            candidate({
              name: 'Forest',
              typeLine: 'Basic Land — Forest',
              updatedAt: BASE_TIME + 1000,
            }),
          ],
        })
      )
    ).toBe(false);
  });

  it('excludes a candidate outside the commander color identity', () => {
    expect(
      hasNewArrivals(
        baseInput({
          commander: card({ name: 'Boros Commander', color_identity: ['R', 'W'] }),
          collectionCards: [
            candidate({ name: 'Blue Card', colorIdentity: ['U'], updatedAt: BASE_TIME + 1000 }),
          ],
        })
      )
    ).toBe(false);
  });

  it('accepts a candidate inside the commander color identity', () => {
    expect(
      hasNewArrivals(
        baseInput({
          commander: card({ name: 'Boros Commander', color_identity: ['R', 'W'] }),
          collectionCards: [
            candidate({ name: 'Red Card', colorIdentity: ['R'], updatedAt: BASE_TIME + 1000 }),
          ],
        })
      )
    ).toBe(true);
  });

  it('excludes a card already in the deck', () => {
    expect(
      hasNewArrivals(
        baseInput({
          cards: [{ card: card({ name: 'Mainboard Card' }) }],
          collectionCards: [candidate({ name: 'Mainboard Card', updatedAt: BASE_TIME + 1000 })],
        })
      )
    ).toBe(false);
  });

  it('non-commander deck: allows a color that is a subset of the union of deck cards', () => {
    expect(
      hasNewArrivals(
        baseInput({
          cards: [{ card: card({ name: 'White Deck Card', color_identity: ['W'] }) }],
          collectionCards: [
            candidate({ name: 'White Card', colorIdentity: ['W'], updatedAt: BASE_TIME + 1000 }),
            candidate({ name: 'Blue Card', colorIdentity: ['U'], updatedAt: BASE_TIME + 1000 }),
          ],
        })
      )
    ).toBe(true);
  });

  it('accounts for a partner commander color identity and name', () => {
    expect(
      hasNewArrivals(
        baseInput({
          commander: card({ name: 'Main Commander', color_identity: ['R'] }),
          partnerCommander: card({ name: 'Partner Commander', color_identity: ['G'] }),
          collectionCards: [
            candidate({ name: 'Green Card', colorIdentity: ['G'], updatedAt: BASE_TIME + 1000 }),
            candidate({ name: 'Partner Commander', updatedAt: BASE_TIME + 1000 }),
          ],
        })
      )
    ).toBe(true);
  });
});

describe('aggregateNewArrivalDecks', () => {
  it('returns an empty array for zero decks', () => {
    expect(aggregateNewArrivalDecks([], [], new Map())).toEqual([]);
  });

  it('sums qualifying owned qty for a deck, deduping printings by name', () => {
    const deck = makeDeck({ id: 'a', updatedAt: BASE_TIME });
    const collectionCards = [
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME + 1000 }),
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME + 2000 }),
    ];
    const result = aggregateNewArrivalDecks([deck], collectionCards, new Map());
    expect(result).toEqual([{ deck, count: 2 }]);
  });

  it('excludes a deck with zero qualifying arrivals', () => {
    const deck = makeDeck({ id: 'a', updatedAt: BASE_TIME + 5000 });
    const collectionCards = [candidate({ name: 'Sol Ring', updatedAt: BASE_TIME + 1000 })];
    expect(aggregateNewArrivalDecks([deck], collectionCards, new Map())).toEqual([]);
  });

  it('skips ineligible candidates (basic land) mixed in with a qualifying one', () => {
    const deck = makeDeck({ id: 'a', updatedAt: BASE_TIME });
    const collectionCards = [
      candidate({ name: 'Forest', typeLine: 'Basic Land — Forest', updatedAt: BASE_TIME + 1000 }),
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME + 1000 }),
    ];
    const result = aggregateNewArrivalDecks([deck], collectionCards, new Map());
    expect(result).toEqual([{ deck, count: 1 }]);
  });

  it('counts every owned copy toward qty even when only some printings are newly acquired', () => {
    const deck = makeDeck({ id: 'a', updatedAt: BASE_TIME });
    const collectionCards = [
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME - 1000 }),
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME - 1000 }),
      candidate({ name: 'Sol Ring', updatedAt: BASE_TIME + 1000 }),
    ];
    const result = aggregateNewArrivalDecks([deck], collectionCards, new Map());
    expect(result).toEqual([{ deck, count: 3 }]);
  });

  it('truncates to the `limit` most-recently-updated decks', () => {
    const decks = Array.from({ length: 25 }, (_, i) => makeDeck({ id: `deck-${i}`, updatedAt: i }));
    const collectionCards = [candidate({ name: 'Sol Ring', updatedAt: 1_000_000 })];
    const result = aggregateNewArrivalDecks(decks, collectionCards, new Map(), 20);
    expect(result).toHaveLength(20);
    const ids = result.map((r) => r.deck.id);
    expect(ids).not.toContain('deck-0');
    expect(ids).not.toContain('deck-4');
    expect(ids).toContain('deck-5');
    expect(ids).toContain('deck-24');
  });
});

describe('aggregateBinderReviewCount', () => {
  function makeCard(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
    return {
      copyId: crypto.randomUUID(),
      name: 'Test Card',
      setCode: 'TST',
      setName: 'Test Set',
      collectorNumber: '1',
      rarity: 'common',
      scryfallId: `id-${Math.random()}`,
      purchasePrice: 1,
      sourceCategory: '',
      sourceFormat: 'plain',
      foil: false,
      finish: 'nonfoil',
      cmc: 2,
      typeLine: 'Instant',
      colorIdentity: ['R'],
      ...overrides,
    };
  }

  function makeBinder(overrides: Partial<BinderDef> = {}): BinderDef {
    return {
      id: `binder-${Math.random()}`,
      name: 'Test Binder',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [{ field: 'name', dir: 'asc' }],
      pocketSize: null,
      doubleSided: false,
      fixedCapacity: null,
      color: '#fff',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    } as BinderDef;
  }

  it('excludes never-reviewed binders from the total', () => {
    const c = makeCard();
    const binder = makeBinder({ filterGroups: [{ filter: { priceMin: 5 } }] });
    const { binders } = materializeBinders([c], [binder], { search: '' });
    expect(aggregateBinderReviewCount(binders, [c], [])).toBe(0);
  });

  it('sums added + removed drift across multiple binders, skipping never-reviewed ones', () => {
    const cheap = makeCard({ scryfallId: 'cheap', name: 'Cheap', purchasePrice: 8 });
    const reviewed = makeBinder({
      filterGroups: [{ filter: { priceMin: 5 } }],
      lastReviewedSnapshot: {
        at: Date.now() - 86_400_000,
        keys: [],
        // Observed at $2 before (under the $5 threshold) — now $8, so it just
        // qualified into the binder: one `added` entry.
        cardSnapshots: { [printingFinishKey(cheap)]: { price: 2 } },
      },
    });
    const neverReviewed = makeBinder({ filterGroups: [{ filter: {} }] });
    const { binders } = materializeBinders([cheap], [reviewed, neverReviewed], { search: '' });

    expect(aggregateBinderReviewCount(binders, [cheap], [])).toBe(1);
  });
});

describe('upcomingGameNights', () => {
  function gameNight(overrides: Partial<GameNight> & { startsAt: number }): GameNight {
    return {
      id: `gn-${Math.random()}`,
      token: 'tok',
      title: 'Game night',
      timezone: null,
      location: null,
      notes: null,
      createdAt: Date.now(),
      cancelledAt: null,
      inviteOnly: false,
      format: null,
      hostUsername: 'host',
      isHost: true,
      myStatus: null,
      rsvps: [],
      awaiting: [],
      options: [],
      series: null,
      blocked: [],
      ...overrides,
    };
  }

  const NOW = 1_000_000;

  it('excludes cancelled nights', () => {
    const nights = [gameNight({ startsAt: NOW + 1000, cancelledAt: Date.now() })];
    expect(upcomingGameNights(nights, NOW)).toEqual([]);
  });

  it('excludes nights that already started', () => {
    const nights = [gameNight({ startsAt: NOW - 1000 })];
    expect(upcomingGameNights(nights, NOW)).toEqual([]);
  });

  it('sorts ascending by startsAt', () => {
    const later = gameNight({ startsAt: NOW + 5000 });
    const sooner = gameNight({ startsAt: NOW + 1000 });
    expect(upcomingGameNights([later, sooner], NOW).map((n) => n.startsAt)).toEqual([
      NOW + 1000,
      NOW + 5000,
    ]);
  });

  it('applies the limit', () => {
    const nights = [1, 2, 3, 4, 5].map((i) => gameNight({ startsAt: NOW + i * 1000 }));
    expect(upcomingGameNights(nights, NOW, 3)).toHaveLength(3);
  });
});
