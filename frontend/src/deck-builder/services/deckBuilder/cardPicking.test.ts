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
import { isOneSidedWipe, type RoleKey } from '@/deck-builder/services/tagger/client';

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

describe('calculateCardPriority — Staples <-> Brew dial', () => {
  const theme = ec({ isThemeSynergyCard: true, synergy: 0.5, inclusion: 5 });
  const highSynergy = ec({ synergy: 0.6, inclusion: 10 });
  const plain = ec({ synergy: 0.1, inclusion: 20 });

  it('brewLevel=0.5 (Balanced) is byte-identical to omitting the param', () => {
    for (const c of [theme, highSynergy, plain]) {
      expect(calculateCardPriority(c, 0.5)).toBe(calculateCardPriority(c));
    }
  });

  it('Staples (0) amplifies inclusion and damps synergy relative to Balanced', () => {
    // Theme card: inclusion term grows, synergy term shrinks.
    expect(calculateCardPriority(theme, 0)).toBe(100 + 0.5 * 50 * 0.4 + 5 * 1.5);
    // High-synergy card: synergy*100 term shrinks, inclusion term grows.
    expect(calculateCardPriority(highSynergy, 0)).toBe(0.6 * 100 * 0.4 + 10 * 1.5);
    // Plain inclusion-only card: pure inclusion amplified.
    expect(calculateCardPriority(plain, 0)).toBe(20 * 1.5);
  });

  it('Brew (1) damps inclusion and amplifies synergy relative to Balanced', () => {
    expect(calculateCardPriority(theme, 1)).toBe(100 + 0.5 * 50 * 1.6 + 5 * 0.5);
    expect(calculateCardPriority(highSynergy, 1)).toBe(0.6 * 100 * 1.6 + 10 * 0.5);
    expect(calculateCardPriority(plain, 1)).toBe(20 * 0.5);
  });

  it('is monotonic: a high-synergy card gains ground on a same-inclusion no-synergy card as brewLevel rises', () => {
    const synergyCard = ec({ synergy: 0.6, inclusion: 20 });
    const noSynergyCard = ec({ synergy: 0, inclusion: 20 });
    let prevGap = -Infinity;
    for (const b of [0, 0.25, 0.5, 0.75, 1]) {
      const gap = calculateCardPriority(synergyCard, b) - calculateCardPriority(noSynergyCard, b);
      expect(gap).toBeGreaterThan(prevGap);
      prevGap = gap;
    }
  });

  it('never lets a genuinely dead card beat a staple that is also the best synergy pick, even at full Brew', () => {
    const staplePlusSynergy = ec({ isThemeSynergyCard: true, synergy: 0.9, inclusion: 90 });
    const deadCard = ec({ synergy: 0, inclusion: 10, isNewCard: true }); // best-case dead card
    expect(calculateCardPriority(staplePlusSynergy, 1)).toBeGreaterThan(
      calculateCardPriority(deadCard, 1)
    );
  });

  it('never rewards obscurity for its own sake: among two zero-synergy cards, lower inclusion still loses at every dial position', () => {
    const moreIncluded = ec({ synergy: 0, inclusion: 30 });
    const lessIncluded = ec({ synergy: 0, inclusion: 10 });
    for (const b of [0, 0.25, 0.5, 0.75, 1]) {
      expect(calculateCardPriority(moreIncluded, b)).toBeGreaterThan(
        calculateCardPriority(lessIncluded, b)
      );
    }
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

  it('threads the Staples <-> Brew dial into its sort', () => {
    const pool = [
      ec({ name: 'Staple', inclusion: 60, synergy: 0 }),
      ec({ name: 'Deep cut', inclusion: 5, synergy: 0.31 }),
    ];
    // Balanced (default): the staple's raw inclusion (60) beats the deep
    // cut's synergy*100+inclusion (31+5=36).
    expect(mergeWithAllNonLand(pool, []).map((c) => c.name)).toEqual(['Staple', 'Deep cut']);
    // Full Brew: damped inclusion (30) loses to amplified synergy+inclusion
    // (49.6+2.5=52.1) — the dial actually reorders the pool.
    expect(mergeWithAllNonLand(pool, [], 1).map((c) => c.name)).toEqual(['Deep cut', 'Staple']);
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

describe('lift tie-break (E71 slice 2)', () => {
  it('breaks an EXACT priority tie in pickFromPrefetched', () => {
    const cards = [ec({ name: 'A', inclusion: 10 }), ec({ name: 'B', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const liftTieBreak = new Map([['b', 5]]);
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
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['B']);
  });

  it('never outranks a card with strictly higher priority, even with a huge lift score', () => {
    const cards = [ec({ name: 'Better', inclusion: 90 }), ec({ name: 'Worse', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const liftTieBreak = new Map([['worse', 999]]);
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
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['Better']);
  });

  it('applies the same exact-tie break in the curve-aware picker', () => {
    const cards = [
      ec({ name: 'A', inclusion: 10, primary_type: 'Creature' }),
      ec({ name: 'B', inclusion: 10, primary_type: 'Creature' }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const liftTieBreak = new Map([['b', 5]]);
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
      undefined,
      liftTieBreak
    );
    expect(picked.map((c) => c.name)).toEqual(['B']);
  });

  it('an absent lift map leaves pick order unchanged (equivalence with pre-lift behavior)', () => {
    const cards = [ec({ name: 'A', inclusion: 10 }), ec({ name: 'B', inclusion: 10 })];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    const picked = pickFromPrefetched(cards, map, 1, new Set(), []);
    expect(picked.map((c) => c.name)).toEqual(['A']); // stable sort keeps input order on a tie
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

describe('pickFromPrefetched game-changer cap (E71 controls audit)', () => {
  const pickWithCap = (cap: number, gameChangerCount: { value: number }) => {
    const cards = [
      ec({ name: 'GC One', inclusion: 90 }),
      ec({ name: 'GC Two', inclusion: 80 }),
      ec({ name: 'Plain', inclusion: 70 }),
    ];
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
    return pickFromPrefetched(
      cards,
      map,
      3,
      new Set(),
      [],
      new Set(),
      null,
      cap,
      gameChangerCount,
      null,
      null,
      null,
      undefined,
      undefined,
      'USD',
      new Set(['GC One', 'GC Two'])
    );
  };

  it('caps game changers at maxGameChangers with a shared running count', () => {
    const gameChangerCount = { value: 0 };
    const picked = pickWithCap(1, gameChangerCount);
    expect(picked.map((c) => c.name)).toEqual(['GC One', 'Plain']);
    expect(picked[0].isGameChanger).toBe(true);
    expect(gameChangerCount.value).toBe(1);
  });

  it('a pre-existing count from earlier phases blocks all further game changers', () => {
    const picked = pickWithCap(1, { value: 1 });
    expect(picked.map((c) => c.name)).toEqual(['Plain']);
  });
});

describe("pickFromPrefetched 'partial' owned-percentage quota (E71 controls audit)", () => {
  const cards = [
    ec({ name: 'Owned Hi', inclusion: 90 }),
    ec({ name: 'Owned Lo', inclusion: 80 }),
    ec({ name: 'Un Hi', inclusion: 70 }),
    ec({ name: 'Un Lo', inclusion: 60 }),
  ];
  const map = new Map(cards.map((c) => [c.name, sc({ name: c.name })]));
  const owned = new Set(['Owned Hi', 'Owned Lo']);

  const pickPartial = (count: number, ownedPercent: number, candidates = cards) =>
    pickFromPrefetched(
      candidates,
      map,
      count,
      new Set(),
      [],
      new Set(),
      null,
      Infinity,
      { value: 0 },
      null,
      null,
      null,
      owned,
      undefined,
      'USD',
      new Set(),
      false,
      'partial',
      ownedPercent
    );

  it('splits picks by the owned quota, not pure priority', () => {
    // 50% of 2 = 1 owned + 1 unowned: "Un Hi" gets the second slot even
    // though "Owned Lo" outranks it on priority — that's the quota working.
    const picked = pickPartial(2, 50);
    expect(picked.map((c) => c.name)).toEqual(['Owned Hi', 'Un Hi']);
  });

  it('relaxes the quota when the owned pool falls short', () => {
    // 100% of 3 = 3 owned wanted but only 1 owned candidate exists — the
    // shortfall fill tops up from the unowned pool instead of underfilling.
    const oneOwned = cards.filter((c) => c.name !== 'Owned Lo');
    const picked = pickPartial(3, 100, oneOwned);
    expect(picked.map((c) => c.name)).toEqual(['Owned Hi', 'Un Hi', 'Un Lo']);
  });
});

describe('role-cap gate (E77 iter-4)', () => {
  // target=1 -> tolerance = max(2, round(1*0.2)) = 2 -> cap = target + tolerance = 3.
  const roleTargets: Record<RoleKey, number> = { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 };

  function pickWithRoleCap(cards: EDHRECCard[], count: number, cardRoleMap: Map<string, RoleKey>) {
    const map = new Map(cards.map((c) => [c.name, sc({ name: c.name, type_line: 'Creature' })]));
    const currentRoleCounts: Record<RoleKey, number> = {
      ramp: 0,
      removal: 0,
      boardwipe: 0,
      cardDraw: 0,
    };
    return pickFromPrefetchedWithCurve(
      cards,
      map,
      count,
      new Set(),
      [],
      { 3: 100 }, // generous curve room so the curve gate never interferes
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
      undefined,
      undefined,
      { cardRoleMap, roleTargets, currentRoleCounts }
    );
  }

  it('caps a surplus role once at target+tolerance, freeing the slot for a role-null payoff', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 75, primary_type: 'Creature' }), // would be picked #4 on pure priority
      ec({ name: 'Payoff', inclusion: 50, primary_type: 'Creature' }), // role-null, lowest priority
    ];
    const cardRoleMap = new Map<string, RoleKey>([
      ['Ramp1', 'ramp'],
      ['Ramp2', 'ramp'],
      ['Ramp3', 'ramp'],
      ['Ramp4', 'ramp'],
    ]);
    const picked = pickWithRoleCap(cards, 4, cardRoleMap);
    // Ramp4 hits the cap (3rd ramp already at count=3) — Payoff takes its slot
    // instead of shipping a 4th surplus ramp card.
    expect(picked.map((c) => c.name)).toEqual(['Ramp1', 'Ramp2', 'Ramp3', 'Payoff']);
  });

  it('never caps a role-null card even when every candidate outranks it', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Filler', inclusion: 10, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>([['Ramp1', 'ramp']]);
    const picked = pickWithRoleCap(cards, 2, cardRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['Ramp1', 'Filler']); // both picked, no role-null gating
  });

  it('escape hatch: admits over-cap candidates rather than shipping the pass short', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 75, primary_type: 'Creature' }),
      ec({ name: 'Ramp5', inclusion: 70, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>(cards.map((c) => [c.name, 'ramp']));
    // No role-null candidate exists to fill the freed slots — the pass MUST
    // fall back to admitting the capped candidates rather than shipping only 3/5.
    const picked = pickWithRoleCap(cards, 5, cardRoleMap);
    expect(picked).toHaveLength(5);
    expect(picked.map((c) => c.name).sort()).toEqual(['Ramp1', 'Ramp2', 'Ramp3', 'Ramp4', 'Ramp5']);
  });

  it('escape-hatch ceiling: admits at most ROLE_CAP_HATCH_MAX_PER_PASS over-cap candidates, then finishes short (iter-6 Slice B)', () => {
    const cards = [
      ec({ name: 'Ramp1', inclusion: 95, primary_type: 'Creature' }),
      ec({ name: 'Ramp2', inclusion: 90, primary_type: 'Creature' }),
      ec({ name: 'Ramp3', inclusion: 85, primary_type: 'Creature' }),
      ec({ name: 'Ramp4', inclusion: 80, primary_type: 'Creature' }),
      ec({ name: 'Ramp5', inclusion: 75, primary_type: 'Creature' }),
      ec({ name: 'Ramp6', inclusion: 70, primary_type: 'Creature' }),
      ec({ name: 'Ramp7', inclusion: 65, primary_type: 'Creature' }),
    ];
    const cardRoleMap = new Map<string, RoleKey>(cards.map((c) => [c.name, 'ramp']));
    // 3 admitted under cap (target=1, tolerance=2 -> cap=3); Ramp4-7 are all
    // over-cap and skipped. Uncapped, the hatch would admit all 4 to hit
    // count=7 — the ceiling caps it at 3 (Ramp4-6, in skip order), so the
    // pass ships 6/7 instead, leaving Ramp7's slot for a role-cap-gated
    // downstream fill to give to an under-target role.
    const picked = pickWithRoleCap(cards, 7, cardRoleMap);
    expect(picked).toHaveLength(6);
    expect(picked.map((c) => c.name).sort()).toEqual([
      'Ramp1',
      'Ramp2',
      'Ramp3',
      'Ramp4',
      'Ramp5',
      'Ramp6',
    ]);
  });
});

// This layer's `priceSanity` param is a plain boolean (defaults false here) —
// the E80 product ruling that it ships ON by default lives one level up, in
// deckGenerator.ts's resolvePriceSanity (see deckGenerator.notes.test.ts).
describe('price-sanity tie-break (E80)', () => {
  // Mox-Diamond-shaped fixture: ExpensiveRock outranks CheapRock on raw
  // inclusion alone (mirrors how the real generator's earlyRampMultiplier
  // boost lets a cmc-0 rock outrank a same-role cmc-2 rock with genuinely
  // higher inclusion) — both 'ramp', inclusion within the 15pt band, price
  // ratio 500x (well past the 20x threshold).
  const expensiveRock = ec({ name: 'ExpensiveRock', inclusion: 20, primary_type: 'Artifact' });
  const cheapRock = ec({ name: 'CheapRock', inclusion: 12, primary_type: 'Artifact' });
  const roleMap = new Map<string, RoleKey>([
    ['ExpensiveRock', 'ramp'],
    ['CheapRock', 'ramp'],
  ]);

  function pickPair(
    cards: EDHRECCard[],
    cardMap: Map<string, ScryfallCard>,
    priceSanity: boolean,
    cardRoleMap: Map<string, RoleKey> = roleMap,
    comboOnlyBoost?: Map<string, number>,
    priceSanityDecided?: Set<string>
  ) {
    return pickFromPrefetchedWithCurve(
      cards,
      cardMap,
      1, // only room for one — forces a real either/or choice
      new Set(),
      [],
      { 0: 100, 1: 100, 2: 100 }, // generous curve room, never gates this test
      {},
      new Set(),
      'Artifact',
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
      undefined,
      undefined,
      {
        cardRoleMap,
        roleTargets: { ramp: 5, removal: 0, boardwipe: 0, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      },
      priceSanity,
      comboOnlyBoost,
      priceSanityDecided
    );
  }

  it('flag off: today’s inclusion-driven order wins (expensive rock picked)', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, false);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('flag on: flips to the dramatically cheaper, comparably-included rock', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true);
    expect(picked.map((c) => c.name)).toEqual(['CheapRock']);
  });

  it('missing price data: inert even with the flag on', () => {
    const cardMap = new Map<string, ScryfallCard>([
      ['ExpensiveRock', sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: {} })], // no usd price
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true);
    // Can't compute a ratio without both prices — falls back to raw priority.
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('inclusion gap beyond the band: a genuinely-better pick is not displaced', () => {
    const bigGapExpensive = ec({
      name: 'BigGapExpensive',
      inclusion: 30,
      primary_type: 'Artifact',
    });
    const bigGapCheap = ec({ name: 'BigGapCheap', inclusion: 5, primary_type: 'Artifact' }); // 25pt gap > 15pt band
    const cardMap = new Map<string, ScryfallCard>([
      [
        'BigGapExpensive',
        sc({ name: 'BigGapExpensive', cmc: 0, type_line: 'Artifact', prices: { usd: '1000.00' } }),
      ],
      [
        'BigGapCheap',
        sc({ name: 'BigGapCheap', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const cardRoleMap = new Map<string, RoleKey>([
      ['BigGapExpensive', 'ramp'],
      ['BigGapCheap', 'ramp'],
    ]);
    const picked = pickPair([bigGapExpensive, bigGapCheap], cardMap, true, cardRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['BigGapExpensive']);
  });

  it('never reorders a candidate carrying a live combo boost', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);
    const comboOnlyBoost = new Map([['ExpensiveRock', 50]]); // a real detected combo piece
    const picked = pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, comboOnlyBoost);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  it('different roles are never compared, even at an extreme price ratio', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRemoval',
        sc({ name: 'CheapRemoval', cmc: 2, type_line: 'Instant', prices: { usd: '1.00' } }),
      ],
    ]);
    const mixedRoleMap = new Map<string, RoleKey>([
      ['ExpensiveRock', 'ramp'],
      ['CheapRemoval', 'removal'],
    ]);
    const cheapRemoval = ec({ name: 'CheapRemoval', inclusion: 15, primary_type: 'Instant' });
    const picked = pickPair([expensiveRock, cheapRemoval], cardMap, true, mixedRoleMap);
    expect(picked.map((c) => c.name)).toEqual(['ExpensiveRock']);
  });

  describe('priceSanityDecided disclosure tracking', () => {
    const cardMap = new Map<string, ScryfallCard>([
      [
        'ExpensiveRock',
        sc({ name: 'ExpensiveRock', cmc: 0, type_line: 'Artifact', prices: { usd: '1119.00' } }),
      ],
      [
        'CheapRock',
        sc({ name: 'CheapRock', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
      ],
    ]);

    it('records the pair when the tie-break actually flips the winner', () => {
      const decided = new Set<string>();
      pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, undefined, decided);
      expect(decided.size).toBe(1);
    });

    it('stays empty when the flag is off (order never flips)', () => {
      const decided = new Set<string>();
      pickPair([expensiveRock, cheapRock], cardMap, false, roleMap, undefined, decided);
      expect(decided.size).toBe(0);
    });

    it('stays empty when a combo boost keeps the tie-break from firing', () => {
      const decided = new Set<string>();
      const comboOnlyBoost = new Map([['ExpensiveRock', 50]]);
      pickPair([expensiveRock, cheapRock], cardMap, true, roleMap, comboOnlyBoost, decided);
      expect(decided.size).toBe(0);
    });

    it('stays empty when the inclusion gap exceeds the band (no comparable alternative)', () => {
      const decided = new Set<string>();
      const bigGapExpensive = ec({
        name: 'BigGapExpensive',
        inclusion: 30,
        primary_type: 'Artifact',
      });
      const bigGapCheap = ec({ name: 'BigGapCheap', inclusion: 5, primary_type: 'Artifact' });
      const cardRoleMap = new Map<string, RoleKey>([
        ['BigGapExpensive', 'ramp'],
        ['BigGapCheap', 'ramp'],
      ]);
      const bigGapCardMap = new Map<string, ScryfallCard>([
        [
          'BigGapExpensive',
          sc({
            name: 'BigGapExpensive',
            cmc: 0,
            type_line: 'Artifact',
            prices: { usd: '1000.00' },
          }),
        ],
        [
          'BigGapCheap',
          sc({ name: 'BigGapCheap', cmc: 2, type_line: 'Artifact', prices: { usd: '2.00' } }),
        ],
      ]);
      pickPair(
        [bigGapExpensive, bigGapCheap],
        bigGapCardMap,
        true,
        cardRoleMap,
        undefined,
        decided
      );
      expect(decided.size).toBe(0);
    });
  });
});

// E109: board-centric wipe-asymmetry preference. Real oracle text (Ruinous
// Ultimatum one-sided vs Farewell symmetric — see tagger/client.test.ts for
// the full ground-truth table verified against Scryfall) so this exercises
// the real isOneSidedWipe classifier, not a stub.
describe('wipe-asymmetry tie-break (E109)', () => {
  const oneSided = ec({ name: 'Ruinous Ultimatum', inclusion: 5, primary_type: 'Sorcery' });
  const symmetric = ec({ name: 'Farewell', inclusion: 40, primary_type: 'Sorcery' }); // outranks on raw priority
  const wipeRoleMap = new Map<string, RoleKey>([
    ['Ruinous Ultimatum', 'boardwipe'],
    ['Farewell', 'boardwipe'],
  ]);
  const wipeCardMap = new Map<string, ScryfallCard>([
    [
      'Ruinous Ultimatum',
      sc({
        name: 'Ruinous Ultimatum',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all nonland permanents your opponents control.',
      }),
    ],
    [
      'Farewell',
      sc({
        name: 'Farewell',
        type_line: 'Sorcery',
        oracle_text:
          'Choose one or more —\n• Exile all artifacts.\n• Exile all creatures.\n• Exile all enchantments.\n• Exile all graveyards.',
      }),
    ],
  ]);

  function pickWipe(preferAsymmetric: boolean, decided?: Set<string>) {
    return pickFromPrefetchedWithCurve(
      [oneSided, symmetric],
      wipeCardMap,
      1, // only room for one — forces a real either/or choice
      new Set(),
      [],
      { 3: 100, 4: 100, 5: 100 },
      {},
      new Set(),
      'Sorcery',
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
      undefined,
      undefined,
      {
        cardRoleMap: wipeRoleMap,
        roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
        isOneSidedWipe: preferAsymmetric ? isOneSidedWipe : undefined,
        wipeAsymmetryDecided: decided,
      }
    );
  }

  it('disabled (not board-centric): the higher-inclusion symmetric staple wins as today', () => {
    const picked = pickWipe(false);
    expect(picked.map((c) => c.name)).toEqual(['Farewell']);
  });

  it('enabled (board-centric): the one-sided wipe wins despite a 35pt inclusion deficit', () => {
    const picked = pickWipe(true);
    expect(picked.map((c) => c.name)).toEqual(['Ruinous Ultimatum']);
  });

  it('two symmetric wipes: falls through to ordinary priority (no one-sided candidate to prefer)', () => {
    const otherSymmetric = ec({ name: 'Toxic Deluge', inclusion: 10, primary_type: 'Sorcery' });
    const cardMap = new Map(wipeCardMap);
    cardMap.set(
      'Toxic Deluge',
      sc({
        name: 'Toxic Deluge',
        type_line: 'Sorcery',
        oracle_text:
          'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.',
      })
    );
    const roleMap = new Map(wipeRoleMap);
    roleMap.set('Toxic Deluge', 'boardwipe');
    const picked = pickFromPrefetchedWithCurve(
      [symmetric, otherSymmetric],
      cardMap,
      1,
      new Set(),
      [],
      { 3: 100, 4: 100, 5: 100 },
      {},
      new Set(),
      'Sorcery',
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
      undefined,
      undefined,
      {
        cardRoleMap: roleMap,
        roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
        currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
        isOneSidedWipe,
      }
    );
    expect(picked.map((c) => c.name)).toEqual(['Farewell']); // higher raw priority, tie-break didn't fire
  });

  it('records the pair when the tie-break actually decides the winner', () => {
    const decided = new Set<string>();
    pickWipe(true, decided);
    expect(decided.size).toBe(1);
  });

  it('stays empty when disabled', () => {
    const decided = new Set<string>();
    pickWipe(false, decided);
    expect(decided.size).toBe(0);
  });
});
