import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  calculateCardPriority,
  isHighSynergyCard,
  mergeWithAllNonLand,
  pickFromPrefetched,
  pickFromPrefetchedWithCurve,
  OWNED_PRIORITY_BOOST,
} from './cardPicking';
import { BracketGuard, bracketCeilings } from './bracketGuard';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';

function ec(overrides: Partial<EDHRECCard> = {}): EDHRECCard {
  return {
    name: 'Card',
    sanitized: 'card',
    primary_type: 'Creature',
    inclusion: 10,
    num_decks: 100,
    ...overrides,
  };
}

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('calculateCardPriority', () => {
  it('gives theme-synergy cards the dominant 100+ boost', () => {
    const themed = calculateCardPriority(
      ec({ isThemeSynergyCard: true, synergy: 0.5, inclusion: 5 })
    );
    const staple = calculateCardPriority(ec({ inclusion: 90 }));
    expect(themed).toBeGreaterThan(staple);
    expect(themed).toBe(100 + 0.5 * 50 + 5);
  });

  it('weights high-synergy (>0.3) non-theme cards by synergy*100', () => {
    expect(calculateCardPriority(ec({ synergy: 0.6, inclusion: 10 }))).toBe(0.6 * 100 + 10);
  });

  it('falls back to inclusion for low-synergy cards, plus a new-card boost', () => {
    expect(calculateCardPriority(ec({ synergy: 0.1, inclusion: 20 }))).toBe(20);
    expect(calculateCardPriority(ec({ synergy: 0.1, inclusion: 20, isNewCard: true }))).toBe(45);
  });
});

describe('isHighSynergyCard', () => {
  it('is true for theme cards or synergy above 0.3', () => {
    expect(isHighSynergyCard(ec({ isThemeSynergyCard: true }))).toBe(true);
    expect(isHighSynergyCard(ec({ synergy: 0.31 }))).toBe(true);
  });
  it('is false at or below the 0.3 synergy threshold with no theme flag', () => {
    expect(isHighSynergyCard(ec({ synergy: 0.3 }))).toBe(false);
    expect(isHighSynergyCard(ec({}))).toBe(false);
  });
});

describe('mergeWithAllNonLand', () => {
  it('adds only Unknown allNonLand cards not already present, sorted by priority', () => {
    const typed = [ec({ name: 'A', inclusion: 10 })];
    const allNonLand = [
      ec({ name: 'A', primary_type: 'Unknown', inclusion: 99 }), // dup name — skipped
      ec({ name: 'B', primary_type: 'Unknown', inclusion: 50 }),
      ec({ name: 'C', primary_type: 'Creature', inclusion: 80 }), // not Unknown — skipped
    ];
    const merged = mergeWithAllNonLand(typed, allNonLand);
    expect(merged.map((c) => c.name)).toEqual(['B', 'A']); // B (50) outranks A (10)
  });
});

describe('pickFromPrefetched', () => {
  it('respects count, color identity, and bans while mutating usedNames', () => {
    const cards = [
      ec({ name: 'InColor', inclusion: 90 }),
      ec({ name: 'OffColor', inclusion: 80 }),
      ec({ name: 'Banned', inclusion: 70 }),
    ];
    const map = new Map<string, ScryfallCard>([
      ['InColor', sc({ name: 'InColor', color_identity: ['G'] })],
      ['OffColor', sc({ name: 'OffColor', color_identity: ['R'] })],
      ['Banned', sc({ name: 'Banned', color_identity: ['G'] })],
    ]);
    const used = new Set<string>();
    const picked = pickFromPrefetched(cards, map, 5, used, ['G'], new Set(['Banned']));
    expect(picked.map((c) => c.name)).toEqual(['InColor']);
    expect(used.has('InColor')).toBe(true);
  });

  it('stops once the requested count is reached', () => {
    const cards = [ec({ name: 'A' }), ec({ name: 'B' }), ec({ name: 'C' })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const picked = pickFromPrefetched(cards, map, 2, new Set(), []);
    expect(picked).toHaveLength(2);
  });

  it('treats available-only as a hard collection constraint', () => {
    const cards = [
      ec({ name: 'Unowned Bomb', inclusion: 99 }),
      ec({ name: 'Owned Free', inclusion: 10 }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const used = new Set<string>();
    const picked = pickFromPrefetched(
      cards,
      map,
      2,
      used,
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Free']),
      undefined,
      'USD',
      new Set(),
      false,
      'available'
    );

    expect(picked.map((c) => c.name)).toEqual(['Owned Free']);
    expect(used.has('Unowned Bomb')).toBe(false);
  });

  it('respects the optional card dependency guard', () => {
    const cards = [
      ec({ name: 'Orphan Payoff', inclusion: 99 }),
      ec({ name: 'Plain Draw', inclusion: 10 }),
    ];
    const map = new Map<string, ScryfallCard>([
      ['Orphan Payoff', sc({ name: 'Orphan Payoff' })],
      ['Plain Draw', sc({ name: 'Plain Draw' })],
    ]);

    const picked = pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      'full',
      100,
      false,
      false,
      (card) => card.name !== 'Orphan Payoff'
    );

    expect(picked.map((c) => c.name)).toEqual(['Plain Draw']);
  });

  it('treats available-only as a hard collection constraint in curve-aware picks', () => {
    const cards = [
      ec({ name: 'Unowned Bomb', inclusion: 99, primary_type: 'Creature' }),
      ec({ name: 'Owned Free', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const used = new Set<string>();
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      2,
      used,
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['Owned Free']),
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'available'
    );

    expect(picked.map((c) => c.name)).toEqual(['Owned Free']);
    expect(used.has('Unowned Bomb')).toBe(false);
  });

  it('respects the optional dependency guard in curve-aware picks', () => {
    const cards = [
      ec({ name: 'Orphan Payoff', inclusion: 99, primary_type: 'Creature' }),
      ec({ name: 'Plain Creature', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));

    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      1,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      undefined,
      (card) => card.name !== 'Orphan Payoff'
    );

    expect(picked.map((c) => c.name)).toEqual(['Plain Creature']);
  });
});

describe("owned-first ('prefer' strategy)", () => {
  const ownedInc = 10;

  // Owned 'O' (inclusion=ownedInc) vs unowned 'U' (inclusion=unownedInc); pick 1
  // in 'prefer' mode. Neither is high-synergy, so they sit in the filler tier
  // where the owned bias operates.
  function pickOnePreferred(unownedInc: number) {
    const cards = [
      ec({ name: 'U', inclusion: unownedInc }),
      ec({ name: 'O', inclusion: ownedInc }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    return pickFromPrefetched(
      cards,
      map,
      1,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['O']), // collectionNames — 'O' is owned
      undefined,
      'USD',
      new Set(),
      false,
      'prefer'
    );
  }

  it('picks the owned card when the inclusion gap is within the boost', () => {
    expect(pickOnePreferred(ownedInc + OWNED_PRIORITY_BOOST - 5).map((c) => c.name)).toEqual(['O']);
  });

  it('does NOT override a clearly-better unowned card — the bias is bounded', () => {
    expect(pickOnePreferred(ownedInc + OWNED_PRIORITY_BOOST + 20).map((c) => c.name)).toEqual([
      'U',
    ]);
  });

  it('applies the same bounded owned-first bias in curve-aware picks', () => {
    const cards = [
      ec({ name: 'U', inclusion: ownedInc + OWNED_PRIORITY_BOOST - 5, primary_type: 'Creature' }),
      ec({ name: 'O', inclusion: ownedInc, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      1,
      new Set(),
      [],
      { 3: 2 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      new Set(['O']),
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'prefer'
    );
    expect(picked.map((c) => c.name)).toEqual(['O']);
  });
});

describe('bracket guardrail in picking', () => {
  it('skips a card that would push a floor signal past the target-bracket ceiling', () => {
    const cards = [
      ec({ name: 'Mana Crypt', inclusion: 99, primary_type: 'Creature' }), // higher priority
      ec({ name: 'Plain Bear', inclusion: 50, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    // Bracket 2 → Game-Changer ceiling 0. Treat 'Mana Crypt' as a GC via the
    // guard's own name set. maxGameChangers stays Infinity and the picker's GC
    // set is empty, so this proves the guard is an INDEPENDENT gate.
    const guard = new BracketGuard(bracketCeilings(2), new Set(['Mana Crypt']));
    const picked = pickFromPrefetchedWithCurve(
      cards,
      map,
      2,
      new Set(),
      [],
      { 3: 5 },
      {},
      new Set(),
      'Creature',
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(),
      false,
      false,
      'full',
      100,
      false,
      false,
      guard
    );
    expect(picked.map((c) => c.name)).toEqual(['Plain Bear']);
  });
});
