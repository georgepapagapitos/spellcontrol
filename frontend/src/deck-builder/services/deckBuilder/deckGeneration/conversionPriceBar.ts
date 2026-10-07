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
 * inclusion points per price doubling past $2). It guards a staple
 * (STAPLE_INCLUSION_BAR, 40% of the commander's decks) and nothing else: a
 * staple leaves for a card priced past the free line and above its own price
 * only when the incoming card's inclusion beats its own by the bar. Every
 * other swap is untouched, so price is never the only reason to move, and a
 * non-staple is never judged on raw inclusion: Reanimate (29.7%, $9.81) is the
 * reanimator deck's engine though a 16% card leaves for it, and no pool signal
 * (synergy 0.06, no theme flag) marks it as such.
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

/** Whether a staple may leave for this incoming card: its play rate pays for the extra price. */
export function premiumIsPaidFor(params: {
  incoming: ScryfallCard;
  incomingPrice: number;
  incomingInclusion: number;
  leavingPrice: number;
  leavingInclusion: number;
}): boolean {
  if (params.leavingInclusion < STAPLE_INCLUSION_BAR) return true;
  const bar = premiumBarPoints(params.incoming, params.incomingPrice, params.leavingPrice);
  return bar <= 0 || params.incomingInclusion - params.leavingInclusion >= bar;
}
