import { describe, it, expect } from 'vitest';
import {
  computeHandStats,
  computeBattlefieldStats,
  computeDeckStats,
  toHandSimCards,
} from './playtest-stats';
import type { PlaytestCard, BattlefieldCard, PlaytestState } from './playtest';
import type { ScryfallCard } from '@/deck-builder/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePlaytestCard(overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return {
    id: 'c1',
    name: 'Card',
    ...overrides,
  };
}

function makeBfCard(
  card: Partial<PlaytestCard> = {},
  bfOverrides: Partial<BattlefieldCard> = {}
): BattlefieldCard {
  return {
    card: makePlaytestCard(card),
    tapped: false,
    counters: {},
    stickers: [],
    x: 0,
    y: 0,
    faceDown: false,
    ...bfOverrides,
  };
}

function makeScryfallCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'scry1',
    name: 'Test Card',
    type_line: 'Creature — Human',
    cmc: 2,
    color_identity: ['W'],
    ...overrides,
  } as ScryfallCard;
}

function makeMinimalState(overrides: Partial<PlaytestState> = {}): PlaytestState {
  return {
    zones: {
      library: [],
      hand: [],
      graveyard: [],
      exile: [],
      command: [],
    },
    battlefield: [],
    rngSeed: 1,
    turn: 1,
    commanderTax: {},
    life: 40,
    opponents: [{ life: 40, commanderDamage: 0 }],
    startingLife: 40,
    startingOpponentLife: 40,
    commanderDamageThreshold: 21,
    tableDefeatedTurn: null,
    past: [],
    ...overrides,
  };
}

// ── computeHandStats ──────────────────────────────────────────────────────────

describe('computeHandStats', () => {
  it('returns all-zero result for empty hand', () => {
    const result = computeHandStats([]);
    expect(result.lands).toBe(0);
    expect(result.nonLands).toBe(0);
    expect(result.colorBreakdown).toEqual({});
    expect(result.cmcBuckets).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('counts 3 lands and 4 spells correctly', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'l1', name: 'Forest', typeLine: 'Basic Land — Forest' }),
      makePlaytestCard({ id: 'l2', name: 'Plains', typeLine: 'Basic Land — Plains' }),
      makePlaytestCard({ id: 'l3', name: 'Island', typeLine: 'Basic Land — Island' }),
      makePlaytestCard({ id: 's1', name: 'Sol Ring', typeLine: 'Artifact', manaValue: 1 }),
      makePlaytestCard({ id: 's2', name: 'Murder', typeLine: 'Instant', manaValue: 3 }),
      makePlaytestCard({ id: 's3', name: 'Dark Ritual', typeLine: 'Instant', manaValue: 1 }),
      makePlaytestCard({ id: 's4', name: 'Creature', typeLine: 'Creature', manaValue: 5 }),
    ];
    const result = computeHandStats(hand);
    expect(result.lands).toBe(3);
    expect(result.nonLands).toBe(4);
  });

  it('buckets CMC=0 into bucket[0], CMC=3 into bucket[3], CMC=8 into bucket[7]', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 's0', name: 'Free', typeLine: 'Instant', manaValue: 0 }),
      makePlaytestCard({ id: 's3', name: 'Mid', typeLine: 'Sorcery', manaValue: 3 }),
      makePlaytestCard({ id: 's8', name: 'Big', typeLine: 'Creature', manaValue: 8 }),
    ];
    const result = computeHandStats(hand);
    expect(result.cmcBuckets[0]).toBe(1);
    expect(result.cmcBuckets[3]).toBe(1);
    // CMC 8 → bucket 7 (7+ open bucket)
    expect(result.cmcBuckets[7]).toBe(1);
  });

  it('reads color breakdown from cardLookup ScryfallCard.color_identity', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'l1', name: 'Forest', typeLine: 'Basic Land — Forest' }),
    ];
    const scry = makeScryfallCard({
      id: 'scry-l1',
      type_line: 'Basic Land — Forest',
      color_identity: ['G'],
    });
    const lookup = new Map<string, ScryfallCard>([['l1', scry]]);
    const result = computeHandStats(hand, lookup);
    expect(result.colorBreakdown).toEqual({ G: 1 });
  });

  it('falls back to PlaytestCard.typeLine + manaValue when ScryfallCard is absent', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'c1', name: 'Creature', typeLine: 'Creature', manaValue: 4 }),
    ];
    const result = computeHandStats(hand);
    expect(result.nonLands).toBe(1);
    expect(result.cmcBuckets[4]).toBe(1);
  });

  it('treats cards without typeLine as non-land', () => {
    const hand: PlaytestCard[] = [makePlaytestCard({ id: 'c1', name: 'Mystery' })];
    const result = computeHandStats(hand);
    expect(result.nonLands).toBe(1);
    expect(result.lands).toBe(0);
  });

  it('marks colourless lands with C in colorBreakdown when color_identity is empty', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'w1', name: 'Wastes', typeLine: 'Basic Land' }),
    ];
    const scry = makeScryfallCard({
      id: 'scry-w1',
      type_line: 'Basic Land',
      color_identity: [],
    });
    const lookup = new Map<string, ScryfallCard>([['w1', scry]]);
    const result = computeHandStats(hand, lookup);
    expect(result.colorBreakdown).toEqual({ C: 1 });
  });
});

// ── computeBattlefieldStats ───────────────────────────────────────────────────

describe('computeBattlefieldStats', () => {
  it('returns all-zero result for empty battlefield', () => {
    const result = computeBattlefieldStats([]);
    expect(result.permanentsByType).toEqual({});
    expect(result.tapped).toBe(0);
    expect(result.untapped).toBe(0);
    expect(result.tokenCount).toBe(0);
    expect(result.avgCmc).toBe(0);
  });

  it('counts tokens separately and excludes them from permanentsByType', () => {
    const bfCards: BattlefieldCard[] = [
      makeBfCard({ name: 'Sol Ring', typeLine: 'Artifact', manaValue: 1, isToken: false }),
      makeBfCard({ name: '1/1 Token', typeLine: 'Creature Token', isToken: true }),
      makeBfCard({ name: '2/2 Token', typeLine: 'Creature Token', isToken: true }),
    ];
    const result = computeBattlefieldStats(bfCards);
    expect(result.tokenCount).toBe(2);
    expect(result.permanentsByType['artifact']).toBe(1);
    expect(result.permanentsByType['creature']).toBeUndefined();
  });

  it('counts tapped and untapped accurately', () => {
    const bfCards: BattlefieldCard[] = [
      makeBfCard({ name: 'Forest', typeLine: 'Basic Land' }, { tapped: true }),
      makeBfCard({ name: 'Island', typeLine: 'Basic Land' }, { tapped: false }),
      makeBfCard({ name: 'Tok', typeLine: 'Creature', isToken: true }, { tapped: true }),
    ];
    const result = computeBattlefieldStats(bfCards);
    expect(result.tapped).toBe(2);
    expect(result.untapped).toBe(1);
  });

  it('classifies creature first for dual-type Artifact Creature', () => {
    const bfCards: BattlefieldCard[] = [
      makeBfCard({ name: 'Myr', typeLine: 'Artifact Creature — Myr', manaValue: 2 }),
    ];
    const result = computeBattlefieldStats(bfCards);
    expect(result.permanentsByType['creature']).toBe(1);
    expect(result.permanentsByType['artifact']).toBeUndefined();
  });

  it('excludes land CMC from avgCmc calculation', () => {
    const bfCards: BattlefieldCard[] = [
      makeBfCard({ name: 'Forest', typeLine: 'Basic Land — Forest', manaValue: 0 }),
      makeBfCard({ name: 'Creature', typeLine: 'Creature — Human', manaValue: 4 }),
    ];
    const result = computeBattlefieldStats(bfCards);
    expect(result.avgCmc).toBe(4);
  });

  it('avgCmc is 0 when no non-land permanents', () => {
    const bfCards: BattlefieldCard[] = [
      makeBfCard({ name: 'Forest', typeLine: 'Basic Land — Forest', manaValue: 0 }),
    ];
    const result = computeBattlefieldStats(bfCards);
    expect(result.avgCmc).toBe(0);
  });
});

// ── computeDeckStats ──────────────────────────────────────────────────────────

describe('computeDeckStats', () => {
  it('reports all zones from state', () => {
    const state = makeMinimalState({
      zones: {
        library: [makePlaytestCard({ id: 'l1' }), makePlaytestCard({ id: 'l2' })],
        hand: [makePlaytestCard({ id: 'h1' })],
        graveyard: [makePlaytestCard({ id: 'g1' })],
        exile: [],
        command: [],
      },
      turn: 3,
    });
    const result = computeDeckStats(state, 60, 1);
    expect(result.turn).toBe(3);
    expect(result.handSize).toBe(1);
    expect(result.mulliganCount).toBe(1);
    expect(result.libraryCount).toBe(2);
    expect(result.graveyardCount).toBe(1);
    expect(result.exileCount).toBe(0);
  });

  it('cardsDrawn = deckSize - library - hand when start of game (no graveyard/exile/bf)', () => {
    const state = makeMinimalState({
      zones: {
        library: new Array(53).fill(null).map((_, i) => makePlaytestCard({ id: `l${i}` })),
        hand: new Array(7).fill(null).map((_, i) => makePlaytestCard({ id: `h${i}` })),
        graveyard: [],
        exile: [],
        command: [],
      },
    });
    const result = computeDeckStats(state, 60, 0);
    expect(result.cardsDrawn).toBe(0);
  });

  it('cardsDrawn accounts for graveyard and exile cards', () => {
    const state = makeMinimalState({
      zones: {
        library: new Array(45).fill(null).map((_, i) => makePlaytestCard({ id: `l${i}` })),
        hand: [makePlaytestCard({ id: 'h1' }), makePlaytestCard({ id: 'h2' })],
        graveyard: [makePlaytestCard({ id: 'g1' })],
        exile: [makePlaytestCard({ id: 'e1' })],
        command: [],
      },
    });
    // 60 - 45(lib) - 2(hand) - 1(gy) - 1(exile) - 0(bf) = 11
    const result = computeDeckStats(state, 60, 0);
    expect(result.cardsDrawn).toBe(11);
  });

  it('returns null for cardsDrawn when deckSize is null', () => {
    const state = makeMinimalState();
    const result = computeDeckStats(state, null, 0);
    expect(result.cardsDrawn).toBeNull();
  });

  it('excludes tokens from battlefieldCount in cardsDrawn math', () => {
    const state = makeMinimalState({
      zones: {
        library: new Array(53).fill(null).map((_, i) => makePlaytestCard({ id: `l${i}` })),
        hand: new Array(7).fill(null).map((_, i) => makePlaytestCard({ id: `h${i}` })),
        graveyard: [],
        exile: [],
        command: [],
      },
      battlefield: [
        makeBfCard({ name: 'Token', isToken: true }),
        makeBfCard({ name: 'Token2', isToken: true }),
      ],
    });
    // Tokens don't count against deckSize — cardsDrawn should still be 0
    const result = computeDeckStats(state, 60, 0);
    expect(result.cardsDrawn).toBe(0);
    expect(result.battlefieldCount).toBe(0);
  });
});

// ── toHandSimCards ────────────────────────────────────────────────────────────

describe('toHandSimCards', () => {
  it('returns empty array for empty hand', () => {
    expect(toHandSimCards([])).toEqual([]);
  });

  it('falls back to PlaytestCard fields when lookup is absent', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'c1', typeLine: 'Basic Land — Forest', manaValue: 0 }),
    ];
    const result = toHandSimCards(hand);
    expect(result[0]?.isLand).toBe(true);
    expect(result[0]?.cmc).toBe(0);
    expect(result[0]?.role).toBeNull();
    expect(result[0]?.colors).toEqual([]);
  });

  it('falls back gracefully when typeLine and manaValue are undefined', () => {
    const hand: PlaytestCard[] = [makePlaytestCard({ id: 'c1' })];
    const result = toHandSimCards(hand);
    expect(result[0]?.isLand).toBe(false);
    expect(result[0]?.cmc).toBe(0);
  });

  it('uses ScryfallCard when available in lookup', () => {
    const hand: PlaytestCard[] = [
      makePlaytestCard({ id: 'c1', name: 'Forest', typeLine: 'Basic Land' }),
    ];
    const scry = makeScryfallCard({
      id: 'scry1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      color_identity: ['G'],
      cmc: 0,
    });
    const lookup = new Map<string, ScryfallCard>([['c1', scry]]);
    const result = toHandSimCards(hand, lookup);
    expect(result[0]?.isLand).toBe(true);
    expect(result[0]?.colors).toEqual(['G']);
  });
});
