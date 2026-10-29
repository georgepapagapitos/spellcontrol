import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { budgetRepairRule } from './budgetRepair';
import type { ConstraintViolation, ObjectiveContext } from './types';

const card = (name: string) => ({ name }) as ScryfallCard;
// Inclusion percent by name; q is its share.
const INCLUSION: Record<string, number> = { Staple: 69, Filler: 30, Played: 75, Weak: 10 };
const ctx = {
  customization: { deckBudget: 25 },
  qualityOf: (c: ScryfallCard) => ({
    q: (INCLUSION[c.name] ?? 0) / 100,
    source: 'page',
    inclusionPct: INCLUSION[c.name] ?? null,
    strength: null,
    note: '',
  }),
} as unknown as ObjectiveContext;
const current = { cards: [card('Staple'), card('Filler')] };
const over: ConstraintViolation[] = [
  { check: 'budget', magnitude: 4, cards: [] } as unknown as ConstraintViolation,
];
const rule = (keepStaples: boolean, violations = over) =>
  budgetRepairRule(ctx, current, () => null, violations, false, keepStaples);

describe('budgetRepairRule', () => {
  it('counts a full-step saving as a repair, whatever it takes out', () => {
    expect(rule(false).counts(2, { in: [card('Weak')], out: [0] })).toBe(true);
  });

  // E1046: Sythis $25 kept its enchantresses through budget convergence and
  // the search then traded them for cents under the deck's broken budget.
  it('never counts a staple leaving for a less-played card once convergence kept the staples', () => {
    expect(rule(true).counts(2, { in: [card('Weak')], out: [0] })).toBe(false);
    // A staple for a card played as much, or a non-staple, still repairs.
    expect(rule(true).counts(2, { in: [card('Played')], out: [0] })).toBe(true);
    expect(rule(true).counts(2, { in: [card('Weak')], out: [1] })).toBe(true);
  });

  it('trades a staple again once the deck is more than 25% over its budget', () => {
    const farOver = [
      { check: 'budget', magnitude: 7, cards: [] } as unknown as ConstraintViolation,
    ];
    expect(rule(true, farOver).counts(2, { in: [card('Weak')], out: [0] })).toBe(true);
  });
});
