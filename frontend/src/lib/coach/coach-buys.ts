/**
 * The buys half of the Cuts lane (E1038 4.2): for the deck's weakest slots, the
 * cards the player does not own that the whole-deck objective says improve the
 * deck most, ranked by that gain per dollar.
 *
 * The gain is the objective's own `delta` for the pairing (coach-cut-swaps.ts),
 * not a play-rate proxy. A card with no price is never guessed at: it is left
 * out of the ranking and counted, so the line can say how many it could not
 * rank. Pure; the price lookup is injected.
 */
import type { Change } from './deck-change';

/** One unowned replacement the objective accepted for a weak slot. */
export interface BuyCandidate {
  /** The card leaving. */
  cutName: string;
  /** The paired swap row: `name` comes in. */
  change: Change;
  /** The objective's gain for the swap. */
  delta: number;
}

export interface RankedBuy extends BuyCandidate {
  price: number;
  /** Objective gain per dollar, with the price floored at {@link PRICE_FLOOR}. */
  perDollar: number;
}

/** Bulk is a quarter: a $0.05 card is not twenty times better value than a $1 one. */
export const PRICE_FLOOR = 0.25;

export interface BuyRanking {
  ranked: RankedBuy[];
  /** Candidates with no price today: not ranked, not guessed. */
  unpriced: number;
}

/** Best gain per dollar first, one buy per incoming card, at most `take`. */
export function rankBuys(
  buys: readonly BuyCandidate[],
  priceOf: (name: string) => number | null | undefined,
  take = 2
): BuyRanking {
  const seen = new Set<string>();
  const priced: RankedBuy[] = [];
  let unpriced = 0;
  for (const b of buys) {
    if (b.delta <= 0) continue;
    const key = b.change.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const price = priceOf(b.change.name);
    if (price == null || !Number.isFinite(price)) {
      unpriced++;
      continue;
    }
    priced.push({ ...b, price, perDollar: b.delta / Math.max(price, PRICE_FLOOR) });
  }
  priced.sort((a, b) => b.perDollar - a.perDollar || b.delta - a.delta);
  return { ranked: priced.slice(0, take), unpriced };
}
