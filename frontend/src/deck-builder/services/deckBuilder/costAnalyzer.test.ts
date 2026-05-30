import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { RecommendedCard } from './deckAnalyzer';
import {
  autoCheckToTarget,
  buildCostPlan,
  classifyConfidence,
  parsePrice,
  pickCheapestAlternative,
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
