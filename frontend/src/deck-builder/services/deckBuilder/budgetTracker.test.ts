import { describe, it, expect, vi, afterEach } from 'vitest';
import { BudgetTracker } from './budgetTracker';
import type { ScryfallCard } from '@/deck-builder/types';

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id-1',
    oracle_id: 'oracle-1',
    name: 'Priced Card',
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

describe('BudgetTracker.getEffectiveCap', () => {
  it('caps a single card at 15% of remaining budget when that is the binding rule', () => {
    // avg = 100/2 = 50, avg*8 = 400; 15% of 100 = 15 -> dynamic cap is 15
    const t = new BudgetTracker(100, 2);
    expect(t.getEffectiveCap(null)).toBeCloseTo(15);
  });

  it('caps at 8x the per-card average when that is the binding rule', () => {
    // many slots: avg = 100/50 = 2, avg*8 = 16; 15% of 100 = 15 -> min is 15
    // tighten so avg*8 binds: budget 10, 50 cards -> avg 0.2, avg*8 = 1.6; 15% = 1.5 -> 1.5 binds
    const t = new BudgetTracker(10, 50);
    expect(t.getEffectiveCap(null)).toBeCloseTo(1.5);
  });

  it('never exceeds the provided static max', () => {
    const t = new BudgetTracker(1000, 1);
    expect(t.getEffectiveCap(5)).toBe(5);
  });

  it('falls back to the static max once no slots remain', () => {
    const t = new BudgetTracker(100, 1);
    t.deductCard(makeCard({ prices: { usd: '10.00' } }));
    expect(t.getEffectiveCap(7)).toBe(7);
  });
});

describe('BudgetTracker deductions', () => {
  it('deducts a card price and one slot', () => {
    const t = new BudgetTracker(100, 10);
    t.deductCard(makeCard({ prices: { usd: '12.50' } }));
    expect(t.remainingBudget).toBeCloseTo(87.5);
    expect(t.cardsRemaining).toBe(9);
  });

  it('ignores unparseable / missing prices but still consumes a slot', () => {
    const t = new BudgetTracker(100, 10);
    t.deductCard(makeCard({ prices: {} }));
    expect(t.remainingBudget).toBe(100);
    expect(t.cardsRemaining).toBe(9);
  });

  it('deductMustIncludes subtracts all costs and slots at once', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const t = new BudgetTracker(100, 10);
    t.deductMustIncludes([
      makeCard({ prices: { usd: '5.00' } }),
      makeCard({ prices: { usd: '15.00' } }),
    ]);
    expect(t.remainingBudget).toBeCloseTo(80);
    expect(t.cardsRemaining).toBe(8);
  });

  it('clamps cardsRemaining at zero', () => {
    const t = new BudgetTracker(100, 1);
    t.deductCard(makeCard({ prices: { usd: '1.00' } }));
    t.deductCard(makeCard({ prices: { usd: '1.00' } }));
    expect(t.cardsRemaining).toBe(0);
  });

  it('clone() deducts independently of the original, including a genuine 0 floor', () => {
    const t = new BudgetTracker(100, 1);
    t.deductCard(makeCard({ prices: { usd: '1.00' } })); // cardsRemaining -> 0
    const clone = t.clone();
    expect(clone.cardsRemaining).toBe(0); // constructor would have floored this to 1

    clone.deductCard(makeCard({ prices: { usd: '50.00' } }));
    expect(clone.remainingBudget).toBeCloseTo(49);
    expect(t.remainingBudget).toBeCloseTo(99); // original untouched
  });
});
