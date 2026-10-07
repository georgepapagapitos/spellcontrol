/**
 * The price bar on a conversion (E572). The role-surplus rebalance swaps the
 * lowest unprotected card of an over-cap role for the best payoff, and with no
 * deck budget set nothing weighed the price of that swap: Sythis partial50
 * traded Exploration (42%, $30.70) for Teferi's Protection (22%, $48.58), a
 * heavily played staple for a pricier, less-played card. The only check was
 * the 20x price-sanity ratio, which a $30 to $48 swap never trips.
 *
 * The rule reuses the user's E509 price bar (buyBar, the term the whole-deck
 * search's ownership objective and the owned-share guard already encode: 8
 * inclusion points per price doubling past $2). It applies only to an incoming
 * card priced past the free line that costs more than the card it replaces;
 * every other swap is untouched, so price is never the only reason to move.
 * The extra price is paid for in play rate:
 *  - a staple (STAPLE_INCLUSION_BAR) leaves only for a card whose inclusion
 *    beats its own by the bar;
 *  - any other card leaves for a card whose survival score clears the pass's
 *    improvement margin by the bar, so theme, lift and synergy count (a
 *    reanimator deck's Reanimate is not judged on raw inclusion).
 */
import { buyBar, PRICE_BAR_FREE_USD } from '../deckObjective/terms/ownership';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import type { ScryfallCard } from '@/deck-builder/types';

const points = (card: ScryfallCard, price: number) =>
  100 * buyBar(card, Number.isFinite(price) && price > 0 ? price : 0);

/** The bar in inclusion points: what the incoming card must add over the leaving one. */
export function premiumBarPoints(
  incoming: ScryfallCard,
  incomingPrice: number,
  leavingPrice: number
): number {
  if (!(incomingPrice > PRICE_BAR_FREE_USD)) return 0;
  return Math.max(0, points(incoming, incomingPrice) - points(incoming, leavingPrice));
}

/**
 * Whether the incoming card's play rate pays for the extra price it costs.
 * `scoreSurplus` is how far its survival score clears the improvement margin.
 */
export function premiumIsPaidFor(params: {
  incoming: ScryfallCard;
  incomingPrice: number;
  incomingInclusion: number;
  leavingPrice: number;
  leavingInclusion: number;
  scoreSurplus: number;
}): boolean {
  const bar = premiumBarPoints(params.incoming, params.incomingPrice, params.leavingPrice);
  if (bar <= 0) return true;
  return params.leavingInclusion >= STAPLE_INCLUSION_BAR
    ? params.incomingInclusion - params.leavingInclusion >= bar
    : params.scoreSurplus >= bar;
}
