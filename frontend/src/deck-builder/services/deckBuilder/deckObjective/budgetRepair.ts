// E1046: when a cheaper-for-dearer swap counts as repairing a broken budget.
//
// While a deck breaks a constraint the search takes only repairs, and any swap
// that lowered spend used to count as one. On the 39-row budget panel it traded
// 34 staples for cents (Dig Through Time, 59% of Yuriko budget decks, for Opt at
// $0.01; Everflowing Chalice 82% for Sisay's Ring at $0.03). A budget-only saving
// now repairs when it saves budgetStep, brings the deck within budget, or brings
// in a card of the same role at least CENT_REPAIR_TIER as played. Swapping for a
// near-equal card for cents still counts: forbidding all of it put $18 back on
// the panel's overage. Measured settings: half as played (REPAIR_TIER) still
// traded Etali, Primal Storm (50%) for Talisman of Indulgence (32%) for $0.13;
// any role traded atraxa-budget10's last wipe for a 14th ramp rock for $0.10.
import type { ScryfallCard } from '@/deck-builder/types';
import { budgetStep } from '../deckFilters';
import type { ConstraintViolation, ObjectiveContext } from './types';

/** A repair's card comes in at least this share as played as the card it replaces, when one can. */
export const REPAIR_TIER = 0.5;

/** A saving under budgetStep repairs only for a same-role card at least this share as played. */
export const CENT_REPAIR_TIER = 0.8;

export interface BudgetRepairRule {
  /** How far a deck's violations put it over budget (0 when within it, or when budget is left as is). */
  overBy: (violations: readonly ConstraintViolation[]) => number;
  /** Whether a swap saving `saving` off the current deck counts as a budget repair. */
  counts: (saving: number, move: { in: ScryfallCard[]; out: number[] }) => boolean;
}

export function budgetRepairRule(
  ctx: ObjectiveContext,
  current: { cards: readonly ScryfallCard[] },
  roleOf: (card: ScryfallCard) => string | null,
  currentViolations: readonly ConstraintViolation[],
  leaveBudget: boolean
): BudgetRepairRule {
  const overBy = (vs: readonly ConstraintViolation[]) =>
    leaveBudget ? 0 : (vs.find((v) => v.check === 'budget')?.magnitude ?? 0);
  const curOver = overBy(currentViolations);
  const budget = ctx.customization.deckBudget;
  const minSaving = budget ? budgetStep(budget) : 0;
  const keepsSlot = (move: { in: ScryfallCard[]; out: number[] }) =>
    move.in.every((c, j) => {
      const out = current.cards[move.out[j]];
      return (
        roleOf(c) === roleOf(out) && ctx.qualityOf(c).q >= CENT_REPAIR_TIER * ctx.qualityOf(out).q
      );
    });
  return {
    overBy,
    counts: (saving, move) => saving >= Math.min(minSaving, curOver) || keepsSlot(move),
  };
}
