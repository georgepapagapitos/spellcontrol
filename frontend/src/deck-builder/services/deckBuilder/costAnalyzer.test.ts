import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RecommendedCard } from './deckAnalyzer';
import {
  autoCheckToTarget,
  buildCostPlan,
  classifyConfidence,
  filterCostPlanByOwnership,
  parsePrice,
  pickCheapestAlternative,
  type CostPlan,
  type CostSwapRow,
} from './costAnalyzer';

// ── Fixtures ────────────────────────────────────────────────────────────

function rec(over: Partial<RecommendedCard> & { name: string }): RecommendedCard {
  return {
    inclusion: 50,
    synergy: 0,
    fillsDeficit: false,
    primaryType: 'Creature',
    ...over,
  };
}

function card(over: Partial<ScryfallCard> & { name: string; usd?: string | null }): ScryfallCard {
  const { usd, name, ...rest } = over;
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 3,
    type_line: 'Creature',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    legalities: { commander: 'legal' },
    prices: { usd: usd ?? null },
    ...rest,
  } as ScryfallCard;
}

// ── parsePrice ──────────────────────────────────────────────────────────

describe('parsePrice', () => {
  it('parses plain and currency/comma-formatted strings', () => {
    expect(parsePrice('12.50')).toBe(12.5);
    expect(parsePrice('$1,234.56')).toBe(1234.56);
    expect(parsePrice('0')).toBe(0);
  });

  it('returns null for missing or non-numeric input', () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('—')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});

// ── classifyConfidence ──────────────────────────────────────────────────

describe('classifyConfidence', () => {
  it('drop-in: similar CMC and popularity', () => {
    expect(classifyConfidence(60, 3, { name: 's', price: 1, inclusion: 50, cmc: 3 })).toBe(
      'drop-in'
    );
  });

  it('sidegrade: bigger popularity drop within band', () => {
    expect(classifyConfidence(60, 3, { name: 's', price: 1, inclusion: 30, cmc: 3 })).toBe(
      'sidegrade'
    );
  });

  it('budget: popularity drop beyond the sidegrade band', () => {
    expect(classifyConfidence(60, 3, { name: 's', price: 1, inclusion: 10, cmc: 3 })).toBe(
      'budget'
    );
  });

  it('not drop-in when CMC differs by more than the band', () => {
    expect(classifyConfidence(60, 3, { name: 's', price: 1, inclusion: 55, cmc: 6 })).toBe(
      'sidegrade'
    );
  });

  it('budget when suggestion has zero inclusion', () => {
    expect(classifyConfidence(60, 3, { name: 's', price: 1, inclusion: 0, cmc: 3 })).toBe('budget');
  });
});

// ── pickCheapestAlternative ─────────────────────────────────────────────

describe('pickCheapestAlternative', () => {
  const pool = [
    rec({ name: 'Pricey', price: '9.00', inclusion: 80 }),
    rec({ name: 'Cheap', price: '1.00', inclusion: 40 }),
    rec({ name: 'Mid', price: '3.00', inclusion: 60 }),
    rec({ name: 'NoPrice', price: undefined, inclusion: 70 }),
  ];

  it('picks the strictly-cheapest priced candidate under the current price', () => {
    const best = pickCheapestAlternative(pool, 5, new Set());
    expect(best?.name).toBe('Cheap');
    expect(best?.price).toBe(1);
  });

  it('skips excluded names', () => {
    const best = pickCheapestAlternative(pool, 5, new Set(['Cheap']));
    expect(best?.name).toBe('Mid');
  });

  it('returns null when nothing is strictly cheaper', () => {
    expect(pickCheapestAlternative(pool, 1, new Set())).toBeNull();
  });
});

// ── autoCheckToTarget ───────────────────────────────────────────────────

function row(over: Partial<CostSwapRow> & { id: string }): CostSwapRow {
  return {
    currentName: over.id,
    currentPrice: 10,
    currentInclusion: 50,
    suggestionName: `${over.id}-alt`,
    suggestionPrice: 1,
    suggestionInclusion: 40,
    savings: 5,
    confidence: 'drop-in',
    category: 'spell',
    ...over,
  };
}

describe('autoCheckToTarget', () => {
  const rows = [
    row({ id: 'A', confidence: 'budget', savings: 8 }),
    row({ id: 'B', confidence: 'drop-in', savings: 3 }),
    row({ id: 'C', confidence: 'drop-in', savings: 5 }),
    row({ id: 'D', confidence: 'sidegrade', savings: 4 }),
  ];
  const enabledAll = new Set<CostSwapRow['confidence']>(['drop-in', 'sidegrade', 'budget']);

  it('returns empty when already at or under target', () => {
    expect(autoCheckToTarget(rows, 20, 20, enabledAll, new Set()).size).toBe(0);
  });

  it('orders by confidence rank then savings, stopping at target', () => {
    // currentTotal 20, target 13 → need 7+ savings.
    // Order: C(drop-in,5), B(drop-in,3) → after C total=15, after B total=12 ≤ 13. Stops.
    const picked = autoCheckToTarget(rows, 20, 13, enabledAll, new Set());
    expect([...picked]).toEqual(['C', 'B']);
  });

  it('skips disabled confidence tiers', () => {
    const enabled = new Set<CostSwapRow['confidence']>(['drop-in']);
    // Only drop-in rows: C(5) then B(3). 20 - 5 - 3 = 12 ≤ 12.
    const picked = autoCheckToTarget(rows, 20, 12, enabled, new Set());
    expect([...picked]).toEqual(['C', 'B']);
  });

  it('skips manually-excluded rows', () => {
    const picked = autoCheckToTarget(rows, 20, 16, enabledAll, new Set(['C']));
    // Skip C; next drop-in is B(3) → 17, still >16; then sidegrade D(4) → 13 ≤16.
    expect([...picked]).toEqual(['B', 'D']);
  });
});

// ── buildCostPlan ───────────────────────────────────────────────────────

describe('buildCostPlan', () => {
  const recommendations = [
    rec({ name: 'Cheap Ramp', role: 'ramp', price: '0.50', inclusion: 45, cmc: 2 }),
    rec({ name: 'Cheap Removal', role: 'removal', price: '0.75', inclusion: 55, cmc: 2 }),
    rec({ name: 'Budget Land', primaryType: 'Land', price: '0.40', inclusion: 30, cmc: 0 }),
  ];

  it('suggests a cheaper role-matched alternative for an expensive deck card', () => {
    const cards = [
      card({ name: 'Sol Ring', usd: '2.00', cmc: 1, deckRole: 'ramp' }),
      card({ name: 'My Commander', usd: '5.00' }),
    ];
    const plan = buildCostPlan(cards, 'My Commander', undefined, recommendations);
    expect(plan.spellRows).toHaveLength(1);
    expect(plan.spellRows[0]).toMatchObject({
      currentName: 'Sol Ring',
      suggestionName: 'Cheap Ramp',
      savings: 1.5,
      category: 'spell',
    });
    expect(plan.currentTotal).toBe(7);
  });

  it('protects the commander, partner, must-includes, basics, and no-price cards', () => {
    const cards = [
      card({ name: 'Cmdr', usd: '3.00', deckRole: 'ramp' }),
      card({ name: 'Partner', usd: '3.00', deckRole: 'ramp' }),
      card({ name: 'Keepme', usd: '3.00', deckRole: 'ramp' }),
      card({ name: 'Forest', usd: '5.00', type_line: 'Basic Land — Forest' }),
      card({ name: 'NoPrice', usd: null, deckRole: 'ramp' }),
    ];
    const plan = buildCostPlan(cards, 'Cmdr', 'Partner', recommendations, {
      mustIncludeNames: new Set(['Keepme']),
    });
    expect(plan.protectedCount).toBe(5);
    expect(plan.spellRows).toHaveLength(0);
    expect(plan.landRows).toHaveLength(0);
  });

  it('routes lands to the land pool and computes minTotal', () => {
    const cards = [
      card({ name: 'Fancy Land', usd: '4.00', type_line: 'Land', deckRole: undefined }),
      card({ name: 'Cmdr', usd: '0' }),
    ];
    const plan = buildCostPlan(cards, 'Cmdr', undefined, recommendations);
    expect(plan.landRows).toHaveLength(1);
    expect(plan.landRows[0].suggestionName).toBe('Budget Land');
    // currentTotal 4 - savings (4 - 0.40 = 3.60) = 0.40
    expect(plan.minTotal).toBeCloseTo(0.4, 5);
  });

  it('does not suggest a card already in the deck', () => {
    const cards = [
      card({ name: 'Expensive Ramp', usd: '2.00', deckRole: 'ramp' }),
      card({ name: 'Cheap Ramp', usd: '0.50', deckRole: 'ramp' }),
      card({ name: 'Cmdr', usd: '0' }),
    ];
    const plan = buildCostPlan(cards, 'Cmdr', undefined, recommendations);
    // "Cheap Ramp" is in the deck, so it can't be offered as a swap target.
    expect(plan.spellRows.find((r) => r.currentName === 'Expensive Ramp')).toBeUndefined();
  });
});

// ── filterCostPlanByOwnership (E23) ──────────────────────────────────────

function swapRow(over: Partial<CostSwapRow> & { currentName: string }): CostSwapRow {
  return {
    id: over.currentName,
    currentPrice: 10,
    currentInclusion: 50,
    suggestionName: `${over.currentName} (budget)`,
    suggestionPrice: 2,
    suggestionInclusion: 45,
    savings: 8,
    confidence: 'drop-in',
    category: 'spell',
    ...over,
  };
}

function plan(over: Partial<CostPlan> = {}): CostPlan {
  return {
    currentTotal: 100,
    minTotal: 0,
    spellRows: [],
    landRows: [],
    protectedCount: 0,
    ...over,
  };
}

describe('filterCostPlanByOwnership', () => {
  it('drops rows for owned-and-available cards and keeps the rest', () => {
    const owned = new Set(['Owned Staple']);
    const p = plan({
      currentTotal: 30,
      spellRows: [
        swapRow({ currentName: 'Owned Staple', currentPrice: 12, savings: 9 }),
        swapRow({ currentName: 'Unowned Pricey', currentPrice: 10, savings: 7 }),
      ],
      landRows: [swapRow({ currentName: 'Owned Staple', category: 'land', savings: 5 })],
    });

    const out = filterCostPlanByOwnership(p, (name) => owned.has(name));

    expect(out.spellRows.map((r) => r.currentName)).toEqual(['Unowned Pricey']);
    expect(out.landRows).toHaveLength(0);
    expect(out.ownedSkippedCount).toBe(2);
  });

  it('recomputes minTotal against only the surviving savings', () => {
    const owned = new Set(['Owned Staple']);
    const p = plan({
      currentTotal: 30,
      minTotal: 16, // stale value from the unfiltered plan (savings 9 + 5 = 14)
      spellRows: [
        swapRow({ currentName: 'Owned Staple', savings: 9 }),
        swapRow({ currentName: 'Unowned Pricey', savings: 5 }),
      ],
    });

    const out = filterCostPlanByOwnership(p, (name) => owned.has(name));

    // currentTotal 30 - surviving savings 5 = 25 (not 16).
    expect(out.minTotal).toBeCloseTo(25, 5);
  });

  it('keeps rows for un-owned and claimed-elsewhere cards (nothing owned-available)', () => {
    const p = plan({
      spellRows: [swapRow({ currentName: 'Unowned' }), swapRow({ currentName: 'In Other Deck' })],
    });

    const out = filterCostPlanByOwnership(p, () => false);

    expect(out.spellRows).toHaveLength(2);
    // Untouched plans are returned by identity so React memoization doesn't churn.
    expect(out).toBe(p);
    expect(out.ownedSkippedCount).toBeUndefined();
  });

  it('accumulates onto a prior ownedSkippedCount', () => {
    const owned = new Set(['A']);
    const p = plan({
      ownedSkippedCount: 1,
      spellRows: [swapRow({ currentName: 'A' }), swapRow({ currentName: 'B' })],
    });

    const out = filterCostPlanByOwnership(p, (name) => owned.has(name));

    expect(out.ownedSkippedCount).toBe(2);
  });
});

// ── budget suggestion quality (T43 PR-0a) ───────────────────────────────

describe('buildCostPlan suggestion quality', () => {
  it('does not offer a cheaper candidate below the inclusion floor', () => {
    const cards = [card({ name: 'Pricey', usd: '20', deckRole: 'ramp' })];
    const recs = [
      rec({ name: 'Fringe', role: 'ramp', inclusion: 0, price: '0.10' }), // too fringe
    ];
    const plan = buildCostPlan(cards, 'Cmdr', undefined, recs);
    expect(plan.spellRows).toHaveLength(0);
  });

  it('still offers a cheaper candidate that clears the inclusion floor', () => {
    const cards = [card({ name: 'Pricey', usd: '20', deckRole: 'ramp' })];
    const recs = [rec({ name: 'Solid', role: 'ramp', inclusion: 40, price: '0.50' })];
    const plan = buildCostPlan(cards, 'Cmdr', undefined, recs);
    expect(plan.spellRows.map((r) => r.suggestionName)).toEqual(['Solid']);
  });

  it('falls back to the primary-type bucket for a spell with no deckRole', () => {
    const cards = [card({ name: 'Roleless', usd: '20', type_line: 'Creature' })]; // no deckRole
    // A roleless recommendation lands in the `type:creature` bucket.
    const recs = [
      rec({ name: 'Cheap Beater', inclusion: 30, price: '0.50', primaryType: 'Creature' }),
    ];
    const plan = buildCostPlan(cards, 'Cmdr', undefined, recs);
    expect(plan.spellRows.map((r) => r.suggestionName)).toEqual(['Cheap Beater']);
  });

  it('never downgrades a fetchland/dual into a lower-fixing land', () => {
    const fetch = card({
      name: 'Flooded Strand',
      usd: '20',
      type_line: 'Land',
      oracle_text:
        'Search your library for a Plains or Island card, put it onto the battlefield, then shuffle.',
    });
    const recs = [
      // cheap but worse fixing (one color) — must be rejected
      rec({
        name: 'Tapland Basic',
        primaryType: 'Land',
        inclusion: 40,
        price: '0.25',
        producedColors: ['U'],
      }),
      // cheap dual that preserves 2-color fixing — acceptable
      rec({
        name: 'Cheap Dual',
        primaryType: 'Land',
        inclusion: 40,
        price: '1.00',
        producedColors: ['W', 'U'],
      }),
    ];
    const plan = buildCostPlan([fetch], 'Cmdr', undefined, recs);
    expect(plan.landRows.map((r) => r.suggestionName)).toEqual(['Cheap Dual']);
  });

  it('does not reject a land candidate that has no color data (degrades gracefully)', () => {
    const dual = card({
      name: 'Hallowed Fountain',
      usd: '15',
      type_line: 'Land',
      produced_mana: ['W', 'U'],
    });
    // Candidate with unknown fixing (producedColors absent) must still be offered
    // rather than dropped — otherwise a missing-enrichment pool kills all swaps.
    const recs = [rec({ name: 'Mystery Land', primaryType: 'Land', inclusion: 40, price: '1.00' })];
    const plan = buildCostPlan([dual], 'Cmdr', undefined, recs);
    expect(plan.landRows.map((r) => r.suggestionName)).toEqual(['Mystery Land']);
  });
});
