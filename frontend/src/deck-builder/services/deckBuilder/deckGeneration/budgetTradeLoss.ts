// E1046: what a budget trade gives up in play. Budget convergence's last
// same-role stage cuts kept cards, and it took the cheapest card in its
// priority band: Mistblade Shinobi (62% of Yuriko budget decks) left for
// Theorix Charm (1.5%), Enchantress's Presence (76% of Sythis budget decks)
// for Angelic Gift (15%). That stage now takes the replacement that gives up
// the fewest inclusion points per dollar saved.
import type { ScryfallCard } from '@/deck-builder/types';
import { budgetStep } from '../deckFilters';
import { STAPLE_OVERAGE } from '../deckObjective/budgetRepair';

/**
 * @param standard inclusion by name on the commander's standard page
 * @param budget   inclusion by name on its budget page
 * @param priceOf  a card's price, null when it has none
 */
export function budgetTradeLoss(
  standard: ReadonlyMap<string, number>,
  budget: ReadonlyMap<string, number>,
  priceOf: (card: ScryfallCard) => number | null
) {
  // A card's play is its best figure on either page. The budget page alone
  // undercounts a staple few budget decks can afford: Hobgoblin Bandit Lord,
  // 62% of Krenko decks and 17% of budget ones, read as even with Sarpadian
  // Simulacrum (17% budget, 0% standard) in E1046's first gate. The standard
  // page alone has no figure for most budget-pool cards.
  const playedIn = (name: string): number =>
    Math.max(standard.get(name) ?? 0, budget.get(name) ?? 0);
  const playLost = (cut: string, added: string): number =>
    Math.max(0, playedIn(cut) - playedIn(added));

  /** Inclusion points given up per dollar saved: lower is the better trade. */
  const lossPerDollar = (cut: ScryfallCard, cutPrice: number, added: ScryfallCard): number =>
    playLost(cut.name, added.name) / Math.max(cutPrice - (priceOf(added) ?? 0), 0.01);

  /** The candidate losing the least play per dollar. On a tie the more played
   *  one, then the cheaper: a cut card played less than every candidate loses
   *  nothing to any of them, and price alone took Divert Disaster (6%) over
   *  Grow from the Ashes (29%) in Tatyova. */
  const leastLossPick = <P extends { sc: ScryfallCard }>(
    cut: ScryfallCard,
    cutPrice: number,
    pairs: P[]
  ): P =>
    [...pairs].sort(
      (a, b) =>
        lossPerDollar(cut, cutPrice, a.sc) - lossPerDollar(cut, cutPrice, b.sc) ||
        playedIn(b.sc.name) - playedIn(a.sc.name) ||
        (priceOf(a.sc) ?? Infinity) - (priceOf(b.sc) ?? Infinity)
    )[0];

  return { leastLossPick, playLost };
}

/** A cut and its replacement, with the dollars saved and the play given up. */
export interface BudgetTrade<C> {
  card: C;
  price: number;
  replacement: C;
  saved: number;
  lost: number;
}

/** Each priced card's trade for its replacement, when it has one. */
export function budgetTrades(
  cards: ScryfallCard[],
  priceOf: (card: ScryfallCard) => number | null,
  playLost: (cut: string, added: string) => number,
  replacementFor: (card: ScryfallCard, price: number) => ScryfallCard | null
): BudgetTrade<ScryfallCard>[] {
  return cards.flatMap((card) => {
    const price = priceOf(card);
    if (price == null || price <= 0) return [];
    const replacement = replacementFor(card, price);
    if (!replacement) return [];
    const saved = price - (priceOf(replacement) ?? 0);
    return [{ card, price, replacement, saved, lost: playLost(card.name, replacement.name) }];
  });
}

/**
 * The next trade for a deck still `gap` over budget: the one losing the least
 * play per dollar (the larger saving on a tie), unless a single trade closes
 * the whole gap for less play than following that order would spend to close
 * it, the usual greedy fix for this knapsack (the order's last trade can
 * overshoot). Priciest-first ignored what a trade gave up: a better-played
 * replacement saved a few cents less, the stage made one more cut, and it took
 * a staple (Hobgoblin Bandit Lord, 62% of Krenko decks, in $50; Satyr Enchanter
 * and Mesa Enchantress in Sythis $25).
 */
export function pickTrade<C>(trades: BudgetTrade<C>[], gap: number): BudgetTrade<C> | null {
  if (trades.length === 0) return null;
  const rate = (t: BudgetTrade<C>) => t.lost / t.saved;
  const byRate = [...trades].sort((a, b) => rate(a) - rate(b) || b.saved - a.saved);
  let need = gap;
  let orderLoss = 0;
  for (const t of byRate) {
    if (need <= 0) break;
    orderLoss += t.lost;
    need -= t.saved;
  }
  if (need > 0) orderLoss = Infinity;
  const closer = trades
    .filter((t) => t.saved >= gap)
    .sort((a, b) => a.lost - b.lost || b.saved - a.saved)[0];
  return closer && closer.lost < orderLoss ? closer : byRate[0];
}

/**
 * The total stage 3 trades kept cards down to. A budget step under the budget,
 * when its trades can reach it: trading to the bare gap left Yuriko $100 about
 * $3 short of the Temporal Trespass (61%) a later pass buys back. Past the
 * budget itself the caller takes only trades that lose no play. When they can't, the staples stay up to STAPLE_OVERAGE over budget
 * and only the excess past that is traded (user ruling 2026-10-28): Sythis $25
 * gave up six 47-76% enchantresses and still ended $3.95 over, while keeping
 * every staple left Atraxa $10 at $63.
 */
export function stapleTarget<C>(trades: BudgetTrade<C>[], total: number, budget: number): number {
  const reachable = total - trades.reduce((sum, t) => sum + t.saved, 0);
  return reachable <= budget ? budget - budgetStep(budget) : budget * (1 + STAPLE_OVERAGE);
}
