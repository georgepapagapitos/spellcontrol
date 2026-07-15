import { describe, it, expect } from 'vitest';
import {
  computeNewArrivals,
  type ArrivalCandidateCard,
  type NewArrivalsInput,
} from './new-arrivals';
import type { ScryfallCard } from '@/deck-builder/types';

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
  };
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

describe('computeNewArrivals', () => {
  it('flags a card acquired after deckUpdatedAt via its import time', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [candidate({ name: 'Bounty Agent', importId: 'imp1' })],
        addedAtByImportId: new Map([['imp1', BASE_TIME + 1000]]),
      })
    );
    expect(result.Creature?.map((r) => r.name)).toEqual(['Bounty Agent']);
  });

  it('excludes a card imported before deckUpdatedAt', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [candidate({ name: 'Bounty Agent', importId: 'imp1' })],
        addedAtByImportId: new Map([['imp1', BASE_TIME - 1000]]),
      })
    );
    expect(result.Creature).toBeUndefined();
  });

  it('window start is whichever of deckUpdatedAt / lastArrivalReviewAt is later', () => {
    // Reviewed after the deck was last updated — a card acquired between the
    // two edges must NOT show (it was already reviewed away).
    const result = computeNewArrivals(
      baseInput({
        deckUpdatedAt: BASE_TIME,
        lastArrivalReviewAt: BASE_TIME + 5000,
        collectionCards: [candidate({ name: 'Bounty Agent', importId: 'imp1' })],
        addedAtByImportId: new Map([['imp1', BASE_TIME + 2000]]),
      })
    );
    expect(result.Creature).toBeUndefined();

    // Acquired after the later (review) edge — shows.
    const result2 = computeNewArrivals(
      baseInput({
        deckUpdatedAt: BASE_TIME,
        lastArrivalReviewAt: BASE_TIME + 5000,
        collectionCards: [candidate({ name: 'Bounty Agent', importId: 'imp1' })],
        addedAtByImportId: new Map([['imp1', BASE_TIME + 6000]]),
      })
    );
    expect(result2.Creature?.map((r) => r.name)).toEqual(['Bounty Agent']);
  });

  it('falls back to updatedAt for a quick-add card with no importId', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [candidate({ name: 'Quick Add', updatedAt: BASE_TIME + 500 })],
      })
    );
    expect(result.Creature?.map((r) => r.name)).toEqual(['Quick Add']);
  });

  it('never re-flags an imported card just because it was later edited', () => {
    // importId present -> import time is the ONLY signal, even though the
    // card's own updatedAt (a later printing/finish edit) is well after the
    // window. Import happened before the deck was last updated.
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'Old Import', importId: 'imp1', updatedAt: BASE_TIME + 9999 }),
        ],
        addedAtByImportId: new Map([['imp1', BASE_TIME - 1000]]),
      })
    );
    expect(result.Creature).toBeUndefined();
  });

  it('excludes basic lands', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({
            name: 'Forest',
            typeLine: 'Basic Land — Forest',
            updatedAt: BASE_TIME + 1000,
          }),
        ],
      })
    );
    expect(result.Land).toBeUndefined();
  });

  it('rejects a card outside the commander color identity', () => {
    const result = computeNewArrivals(
      baseInput({
        commander: card({ name: 'Boros Commander', color_identity: ['R', 'W'] }),
        collectionCards: [
          candidate({ name: 'Blue Card', colorIdentity: ['U'], updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(result.Creature).toBeUndefined();
  });

  it('accepts a card inside the commander color identity', () => {
    const result = computeNewArrivals(
      baseInput({
        commander: card({ name: 'Boros Commander', color_identity: ['R', 'W'] }),
        collectionCards: [
          candidate({ name: 'Red Card', colorIdentity: ['R'], updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(result.Creature?.map((r) => r.name)).toEqual(['Red Card']);
  });

  it('non-commander deck: allows a color that is a subset of the union of deck cards', () => {
    const result = computeNewArrivals(
      baseInput({
        cards: [
          { card: card({ name: 'Red Deck Card', color_identity: ['R'] }) },
          { card: card({ name: 'White Deck Card', color_identity: ['W'] }) },
        ],
        collectionCards: [
          candidate({ name: 'White Card', colorIdentity: ['W'], updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Blue Card', colorIdentity: ['U'], updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(result.Creature?.map((r) => r.name)).toEqual(['White Card']);
  });

  it('excludes cards already in the deck, by name, including the commander/sideboard', () => {
    const result = computeNewArrivals(
      baseInput({
        commander: card({ name: 'My Commander', color_identity: ['G'] }),
        cards: [{ card: card({ name: 'Mainboard Card', color_identity: ['G'] }) }],
        sideboard: [{ card: card({ name: 'Sideboard Card', color_identity: ['G'] }) }],
        collectionCards: [
          candidate({ name: 'My Commander', colorIdentity: ['G'], updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Mainboard Card', colorIdentity: ['G'], updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Sideboard Card', colorIdentity: ['G'], updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(result.Creature).toBeUndefined();
  });

  it('dedupes multiple printings of the same name into one row with a combined qty', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME + 2000 }),
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME + 3000 }),
        ],
      })
    );
    expect(result.Artifact).toHaveLength(1);
    expect(result.Artifact?.[0]).toMatchObject({ name: 'Sol Ring', qty: 3 });
  });

  it('counts every owned copy toward qty even when only some printings are newly acquired', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME - 1000 }),
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME - 1000 }),
          candidate({ name: 'Sol Ring', typeLine: 'Artifact', updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(result.Artifact).toHaveLength(1);
    expect(result.Artifact?.[0]).toMatchObject({ name: 'Sol Ring', qty: 3 });
  });

  it('buckets by classifyType so counts match the deck panels', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'A Land', typeLine: 'Land', updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'An Instant', typeLine: 'Instant', updatedAt: BASE_TIME + 1000 }),
          candidate({
            name: 'A Creature',
            typeLine: 'Creature — Elf',
            updatedAt: BASE_TIME + 1000,
          }),
        ],
      })
    );
    expect(result.Land?.map((r) => r.name)).toEqual(['A Land']);
    expect(result.Instant?.map((r) => r.name)).toEqual(['An Instant']);
    expect(result.Creature?.map((r) => r.name)).toEqual(['A Creature']);
  });

  it('orders rows deterministically: score desc, then name asc as a stable tiebreak', () => {
    const result = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'Zeta', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Alpha', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Beta', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    // No deck cards to score against -> every candidate scores 0 -> pure
    // alphabetical tiebreak, and re-running must produce the identical order
    // (no unseeded randomness).
    const names = result.Instant?.map((r) => r.name);
    expect(names).toEqual(['Alpha', 'Beta', 'Zeta']);

    const again = computeNewArrivals(
      baseInput({
        collectionCards: [
          candidate({ name: 'Zeta', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Alpha', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
          candidate({ name: 'Beta', typeLine: 'Instant', cmc: 2, updatedAt: BASE_TIME + 1000 }),
        ],
      })
    );
    expect(again.Instant?.map((r) => r.name)).toEqual(names);
  });

  it('ranks a closer-CMC same-bucket candidate above a farther one', () => {
    const result = computeNewArrivals(
      baseInput({
        cards: [{ card: card({ name: 'Deck Instant', type_line: 'Instant', cmc: 2 }) }],
        collectionCards: [
          candidate({ name: 'Far CMC', typeLine: 'Instant', cmc: 6, updatedAt: BASE_TIME + 1000 }),
          candidate({
            name: 'Close CMC',
            typeLine: 'Instant',
            cmc: 2,
            updatedAt: BASE_TIME + 1000,
          }),
        ],
      })
    );
    expect(result.Instant?.map((r) => r.name)).toEqual(['Close CMC', 'Far CMC']);
  });
});
