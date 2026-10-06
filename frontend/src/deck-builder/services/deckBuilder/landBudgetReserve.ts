// E561: a budget build picks its spells before its lands, so by the time the
// land base runs the deck's money is gone (Atraxa budget75: $0.94 left, 20 of
// 23 nonbasics seated, the rest basics). The reserve holds back what the
// nonbasic base costs from the spell picks; generateLands gives it back as it
// starts (BudgetTracker.releaseLandReserve) and paces its picks against the
// cheapest candidates (BudgetTracker.planLandPhase).
import { logger } from '@/lib/util/logger';
import { BASIC_LAND_NAMES } from '@/lib/collection/allocations';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  commanderSearchIdentity,
  getCardPrice,
  getCardsByNames,
  isMdfcLand,
  searchCards,
} from '@/deck-builder/services/scryfall/client';
import type { BudgetTracker } from './budgetTracker';
import {
  fitsColorIdentity,
  fitsLandSlot,
  isOwnedBudgetExempt,
  violatesUserCaps,
  type UserCapsConfig,
} from './deckFilters';
import type { GenerationState } from './deckGeneration/state';

/** Smallest reserve that still seats the target is the sum of the N cheapest
 *  viable nonbasics; the land picker ranks by merit, not price, so it gets
 *  some room above that. */
export const LAND_RESERVE_SLACK = 1.75;
/** A land tail costing no more than this many budget slots needs no hold. */
export const LAND_TAIL_SLOTS = 3;
/** Spells keep at least this share of the budget however many lands cost. */
export const LAND_RESERVE_MAX_SHARE = 0.2;
/** How many of the newest on-identity nonbasics the merit widen adds. */
export const MERIT_POOL_MAX = 40;

/** The merit widen's candidates (E116): the newest on-identity plain nonbasic
 *  lands, which EDHREC's list can't contain yet and which carry most of the
 *  cheap tapped fixing. Best-effort: a failed search is an empty pool. */
export async function fetchMeritLands(
  colorIdentity: string[],
  skip: (card: ScryfallCard) => boolean
): Promise<ScryfallCard[]> {
  try {
    const query =
      colorIdentity.length > 0
        ? `t:land (${colorIdentity.map((c) => `o:{${c}}`).join(' OR ')}) -t:basic`
        : `t:land id:c -t:basic`;
    const resp = await searchCards(query, commanderSearchIdentity(colorIdentity), {
      order: 'released',
    });
    const out: ScryfallCard[] = [];
    for (const card of resp.data) {
      if (out.length >= MERIT_POOL_MAX) break;
      if (skip(card) || isMdfcLand(card)) continue;
      out.push(card);
    }
    return out;
  } catch {
    return [];
  }
}

/** Ascending prices of the candidates that clear the user's hard caps. */
export function landCandidatePrices(
  cards: Iterable<ScryfallCard>,
  colorIdentity: string[],
  caps: UserCapsConfig,
  collectionNames: Set<string> | undefined
): number[] {
  const prices: number[] = [];
  for (const card of cards) {
    if (
      !fitsLandSlot(card) ||
      !fitsColorIdentity(card, colorIdentity) ||
      violatesUserCaps(card, caps, collectionNames)
    ) {
      continue;
    }
    const exempt = isOwnedBudgetExempt(card.name, collectionNames, !!caps.ignoreOwnedBudget);
    const price = exempt ? 0 : parseFloat(getCardPrice(card, caps.currency) ?? '');
    prices.push(Number.isFinite(price) ? price : 0);
  }
  return prices.sort((a, b) => a - b);
}

/** Reserve for the nonbasic slots, taken off `tracker`. Returns the amount held
 *  (0 when there is nothing to size it from). */
export async function reserveLandBudget(
  state: GenerationState,
  tracker: BudgetTracker,
  slots: number
): Promise<number> {
  const { cfg, context } = state;
  const edhrecLands = state.edhrecData?.cardlists.lands ?? [];
  if (slots <= 0 || edhrecLands.length === 0) return 0;
  // The pool generateLands picks from: the top EDHREC slice plus the merit widen.
  const names = edhrecLands
    .filter(
      (c) =>
        !BASIC_LAND_NAMES.has(c.name) &&
        !state.usedNames.has(c.name) &&
        !state.bannedCards.has(c.name)
    )
    .slice(0, slots * 2)
    .map((c) => c.name);
  let pool: Map<string, ScryfallCard>;
  try {
    pool = await getCardsByNames(names, undefined, cfg.preferredSet, { arenaOnly: cfg.arenaOnly });
  } catch {
    return 0;
  }
  if (cfg.preferredSet) {
    for (const [name, card] of pool) if (card.set !== cfg.preferredSet) pool.delete(name);
  }
  for (const card of await fetchMeritLands(
    context.colorIdentity,
    (c) => state.usedNames.has(c.name) || state.bannedCards.has(c.name) || pool.has(c.name)
  )) {
    pool.set(card.name, card);
  }
  const prices = landCandidatePrices(
    pool.values(),
    context.colorIdentity,
    cfg,
    context.collectionNames
  );
  const cheapest = prices.slice(0, slots);
  const floorCost = cheapest.reduce((a, b) => a + b, 0);
  // Spells leave about a slot's worth of money behind (Atraxa budget75: $0.94
  // against a $0.87 slot). A tail that costs only a few slots' worth seats from
  // that, as it always did; holding money for it only reshuffles the spells.
  const slotWorth = tracker.remainingBudget / Math.max(1, tracker.cardsRemaining);
  if (floorCost <= LAND_TAIL_SLOTS * slotWorth) return 0;
  const reserve = Math.min(
    floorCost * LAND_RESERVE_SLACK - slotWorth,
    Math.max(0, tracker.remainingBudget) * LAND_RESERVE_MAX_SHARE
  );
  if (reserve <= 0) return 0;
  tracker.reserveForLands(reserve);
  logger.debug(
    `[DeckGen] E561 land reserve ${reserve.toFixed(2)} for ${cheapest.length} nonbasics`
  );
  return reserve;
}
