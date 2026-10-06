// Tracks deck spend during generation and derives a dynamic per-card price cap.
// Pure stateful helper (instance state only) — extracted verbatim from
// deckGenerator.ts for isolation and unit testing.
import { logger } from '@/lib/util/logger';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';

/**
 * Tracks total deck spending and dynamically adjusts per-card price cap.
 * Hard cap — deck total will not exceed the set budget.
 */
export class BudgetTracker {
  remainingBudget: number;
  cardsRemaining: number;
  currency: 'USD' | 'EUR';
  /** E561: money held back from the spell picks for the nonbasic land base
   *  (landBudgetReserve.ts), given back when generateLands starts. */
  landReserve = 0;
  /** E561: the land phase's pacing — nonbasic slots still to seat and the
   *  price of the costliest of the cheapest `slots` candidates. 0 = no phase. */
  landSlots = 0;
  landFloor = 0;

  constructor(totalBudget: number, totalCardsToSelect: number, currency: 'USD' | 'EUR' = 'USD') {
    this.remainingBudget = totalBudget;
    this.cardsRemaining = Math.max(1, totalCardsToSelect);
    this.currency = currency;
  }

  /**
   * Get the effective per-card price cap.
   * Uses two rules to prevent budget blowout:
   * 1. No single card can exceed 15% of remaining budget
   * 2. No single card can exceed 8x the per-card average
   * This spreads the budget across all slots — key cards can still cost
   * several times the average, but no single pick dominates.
   */
  getEffectiveCap(staticMax: number | null, mayUseLandReserve = false): number | null {
    if (this.cardsRemaining <= 0) return staticMax;
    // E561: an uncapped spend (combo seat, staple rock) can push the held
    // remainder to zero, and a zero remainder lifts the cap off every spell
    // (see below). Drop the hold then: the spells go on under a small positive
    // cap, as they would with no hold, instead of buying out the deck.
    if (this.landReserve > 0 && this.remainingBudget <= 0) this.releaseLandReserve();
    // E561: a staple (STAPLE_INCLUSION_BAR) is never priced out by the money
    // held for the land base; it sees the budget as if nothing were held.
    const remaining = this.remainingBudget + (mayUseLandReserve ? this.landReserve : 0);
    const avg = remaining / this.cardsRemaining;
    const dynamicCap = Math.min(
      remaining * 0.15, // max 15% of remaining budget
      avg * 8 // max 8x average per card
    );
    // Budget already exhausted (deductMustIncludes can drive remainingBudget
    // negative) — a Math.max(0, ...) floor here would clamp every remaining
    // pick to exactly $0, i.e. ban every priced card for the rest of
    // generation instead of just pacing spend. Fall back to the static cap
    // (or uncapped) so picking can continue; phaseBudgetConverge reconciles
    // the total afterward.
    if (dynamicCap <= 0) return staticMax;
    const cap = this.landSlots > 0 ? this.landPhaseCap(dynamicCap) : dynamicCap;
    if (staticMax === null) return cap;
    return Math.min(staticMax, cap);
  }

  /** E561: the 15%-of-remaining rule shrinks with every pick and `cardsRemaining`
   *  counts every slot, not just the nonbasic ones, so a merit-ranked land base
   *  spent the lot on its first picks and left the tail unseatable. Cap a pick
   *  at what leaves the cheapest price for every slot still to fill; the N
   *  cheapest candidates stay affordable however far the dynamic cap fell. */
  private landPhaseCap(dynamicCap: number): number {
    const leaveForRest = this.remainingBudget - (this.landSlots - 1) * this.landFloor;
    return Math.max(
      Math.min(this.landFloor, this.remainingBudget),
      Math.min(dynamicCap, leaveForRest)
    );
  }

  /** Hold `amount` back from the spell picks. */
  reserveForLands(amount: number): void {
    this.landReserve = amount;
    this.remainingBudget -= amount;
  }

  /** Give the held money back as the land phase starts (no-op without one). */
  releaseLandReserve(): void {
    this.remainingBudget += this.landReserve;
    this.landReserve = 0;
  }

  /** Pace the nonbasic picks: `slots` to seat, the costliest of the cheapest
   *  `slots` candidates is `floor`. */
  planLandPhase(slots: number, floor: number): void {
    this.landSlots = Math.max(0, slots);
    this.landFloor = floor;
  }

  /** Nonbasic picks are done: later phases pace normally again. */
  endLandPhase(): void {
    this.landSlots = 0;
    this.landFloor = 0;
  }

  /** Deduct card price after adding it to the deck */
  deductCard(card: ScryfallCard): void {
    const priceStr = getCardPrice(card, this.currency);
    if (priceStr) {
      const price = parseFloat(priceStr);
      if (!isNaN(price)) {
        this.remainingBudget -= price;
      }
    }
    this.cardsRemaining = Math.max(0, this.cardsRemaining - 1);
    if (this.landSlots > 0) this.landSlots--;
  }

  /** Independent snapshot with the same remaining budget/cards/currency —
   *  for a caller that needs to test a large batch of candidates against
   *  the current picture without committing real deductions for the
   *  (usually most of them) it doesn't end up keeping (e.g. the
   *  land-squeeze wildcard scan). Bypasses the constructor's `Math.max(1,
   *  ...)` floor so a genuine 0 stays 0. */
  clone(): BudgetTracker {
    const copy = new BudgetTracker(this.remainingBudget, this.cardsRemaining, this.currency);
    copy.cardsRemaining = this.cardsRemaining;
    return copy;
  }

  /** Deduct cost of must-include cards upfront */
  deductMustIncludes(cards: ScryfallCard[]): void {
    for (const card of cards) {
      const priceStr = getCardPrice(card, this.currency);
      if (priceStr) {
        const price = parseFloat(priceStr);
        if (!isNaN(price)) {
          this.remainingBudget -= price;
        }
      }
      this.cardsRemaining = Math.max(0, this.cardsRemaining - 1);
    }
    const sym = this.currency === 'EUR' ? '€' : '$';
    logger.debug(
      `[BudgetTracker] After must-includes: ${sym}${this.remainingBudget.toFixed(2)} remaining for ${this.cardsRemaining} cards`
    );
  }
}
