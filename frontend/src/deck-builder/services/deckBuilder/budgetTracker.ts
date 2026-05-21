// Tracks deck spend during generation and derives a dynamic per-card price cap.
// Pure stateful helper (instance state only) — extracted verbatim from
// deckGenerator.ts for isolation and unit testing.
import { logger } from '@/lib/logger';
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
  getEffectiveCap(staticMax: number | null): number | null {
    if (this.cardsRemaining <= 0) return staticMax;
    const avg = this.remainingBudget / this.cardsRemaining;
    const dynamicCap = Math.min(
      this.remainingBudget * 0.15, // max 15% of remaining budget
      avg * 8 // max 8x average per card
    );
    if (staticMax === null) return Math.max(0, dynamicCap);
    return Math.max(0, Math.min(staticMax, dynamicCap));
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
