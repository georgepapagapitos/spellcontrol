import type { EnrichedCard } from '../types';

/**
 * Cost-basis roll-up (E203): what the user paid vs what those same copies are
 * worth now.
 *
 * Deliberately NOT a second daily series alongside `value-history.ts`. Basis
 * only changes when the user edits it, and the market side of the comparison is
 * already trended there — so this is derived live from the collection on every
 * read instead of being snapshotted.
 *
 * The whole feature lives or dies on honesty about coverage: a collection where
 * 300 of 8,000 copies have a recorded price cannot report a collection-wide
 * gain. So a copy is only counted when it can be compared on BOTH sides, and
 * callers must render the coverage numbers next to the money.
 */
export interface CostBasisSummary {
  /** Copies counted on both sides — the only ones `basis`/`market` describe. */
  covered: number;
  /** Copies considered (the whole collection), for the coverage readout. */
  total: number;
  /** Sum of what was paid, over covered copies only. */
  basis: number;
  /** Sum of current market value, over covered copies only. */
  market: number;
  /** `market − basis`. Positive = up on what was paid. */
  gain: number;
}

/**
 * Roll up cost basis vs market value over the copies where both are known.
 *
 * A copy counts only when all three hold — each exclusion exists to stop a
 * missing value from being read as a real zero:
 *   - `acquiredPrice > 0` — absent/zero basis means "never recorded", not free.
 *     Counting those as $0 paid turns the whole collection into pure profit.
 *   - `purchasePrice > 0` — an unpriced printing (Scryfall has no price) would
 *     otherwise read as a total loss on a card that's merely unpriced.
 *   - the basis currency matches the active display currency — a €-basis
 *     against a $-market snapshot is a category error, so mismatched copies
 *     drop out of coverage rather than silently skewing the total (same
 *     filter-don't-mix rule as `ValuePoint.currency`).
 *
 * `market` reads `purchasePrice`, which callers must have already passed
 * through `applyPrices` (the store does this) so it holds the live price in the
 * active currency.
 */
export function summarizeCostBasis(cards: EnrichedCard[], currency: string): CostBasisSummary {
  let covered = 0;
  let basis = 0;
  let market = 0;
  for (const c of cards) {
    const paid = c.acquiredPrice ?? 0;
    const now = c.purchasePrice ?? 0;
    if (paid <= 0 || now <= 0) continue;
    if ((c.acquiredCurrency ?? 'USD') !== currency) continue;
    covered += 1;
    basis += paid;
    market += now;
  }
  return { covered, total: cards.length, basis, market, gain: market - basis };
}
