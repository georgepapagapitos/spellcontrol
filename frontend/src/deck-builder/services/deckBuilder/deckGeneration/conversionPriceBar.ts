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
 * inclusion points per price doubling past $2). A swap that costs more than
 * the card it replaces must be paid for in play rate: the incoming card's
 * inclusion has to beat the leaving card's by the extra bar. A swap that costs
 * the same or less is untouched, so price is never the only reason to move.
 */
import { buyBar } from '../deckObjective/terms/ownership';
import type { ScryfallCard } from '@/deck-builder/types';

/** The bar in inclusion points: what the incoming card must add over the leaving one. */
export function premiumBarPoints(
  incoming: ScryfallCard,
  incomingPrice: number,
  leavingPrice: number
): number {
  const bar = (card: ScryfallCard, price: number) =>
    100 * buyBar(card, Number.isFinite(price) && price > 0 ? price : 0);
  // The leaving card is a spell here, so its bar uses the spell scale too.
  const incomingBar = bar(incoming, incomingPrice);
  const leavingBar = 100 * buyBar(incoming, Number.isFinite(leavingPrice) ? leavingPrice : 0);
  return Math.max(0, incomingBar - leavingBar);
}

/** Whether the incoming card's play rate pays for the extra price it costs. */
export function premiumIsPaidFor(
  incoming: ScryfallCard,
  incomingPrice: number,
  incomingInclusion: number,
  leavingPrice: number,
  leavingInclusion: number
): boolean {
  const bar = premiumBarPoints(incoming, incomingPrice, leavingPrice);
  return bar <= 0 || incomingInclusion - leavingInclusion >= bar;
}
