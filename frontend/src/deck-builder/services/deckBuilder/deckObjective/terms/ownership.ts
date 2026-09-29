/**
 * Ownership: what the deck costs THIS user, read from the build's collection
 * strategy. Zero for a build with no collection: the budget constraint caps
 * spend there, and cheaper isn't better inside it.
 *
 * With a collection, an owned card costs nothing, and every unowned
 * non-basic card costs its price, turned into card-equivalents at the rate
 * the strategy implies a user will pay for one card of quality:
 *
 *   dollarsPerCard = full / available: DOLLARS_OWNED_ONLY (buying breaks the
 *                      promise; the hard constraint already says so, this
 *                      term ranks two decks that both break it)
 *                    partial N%:      DOLLARS_OWNED_ONLY × 100 / N (a 50%
 *                      share user tolerates buying twice as readily)
 *                    prefer:          DOLLARS_PREFER
 *                    a deck budget caps it at budget / BUDGET_CARDS
 *   value = −buy cost / dollarsPerCard  (+ OWNED_BONUS per owned card, prefer)
 *
 * The rates are anchored on one sanity rule: for any user who allows buying,
 * a $1-2 staple (Sol Ring, Arcane Signet) costs at most a tenth of a card, so
 * the generator still buys it; for an owned-only user a $28 land costs almost
 * three cards. (A first cut at $5 / $25 made a $30 card cost three cards at a
 * 50% share and put money above every quality loss; the anchor was set after
 * that run, so it is not blind.)
 *
 * "Lean on mine" (prefer, hint "Owned-first") asks for owned cards when they
 * are close: an owned card is worth OWNED_BONUS over an unowned one, a
 * quarter of a card, so an owned card up to a quarter-card weaker is the one
 * to play. That is the setting's promise, set a priori, not fit to a gate.
 */
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardNote, ObjectiveContext } from '../types';
import { isBasicLand } from '../context';
import { round2, type TermFn } from './shared';

export const DOLLARS_OWNED_ONLY = 10;
export const DOLLARS_PREFER = 40;
export const BUDGET_CARDS = 10;
export const OWNED_BONUS = 0.25;

function owns(names: ReadonlySet<string>, card: ScryfallCard): boolean {
  return names.has(card.name) || names.has(frontFaceName(card.name));
}

/** Dollars one card-equivalent of quality is worth to this build's user; null when no collection. */
export function dollarsPerCard(ctx: ObjectiveContext): number | null {
  const cz = ctx.customization;
  if (!ctx.ownedNames || cz.collectionMode === false) return null;
  const strategy = cz.collectionStrategy ?? 'full';
  let rate =
    strategy === 'prefer'
      ? DOLLARS_PREFER
      : strategy === 'partial'
        ? (DOLLARS_OWNED_ONLY * 100) / Math.max(10, cz.collectionOwnedPercent ?? 100)
        : DOLLARS_OWNED_ONLY;
  if (cz.deckBudget) rate = Math.min(rate, cz.deckBudget / BUDGET_CARDS);
  return rate;
}

export const ownershipTerm: TermFn = (deck, ctx) => {
  const rate = dollarsPerCard(ctx);
  if (rate === null || !ctx.ownedNames) {
    return { value: 0, summary: 'no collection', cards: [] };
  }
  const currency = ctx.customization.currency ?? 'USD';
  const prefer = ctx.customization.collectionStrategy === 'prefer';
  const notes: CardNote[] = [];
  let spend = 0;
  let owned = 0;
  for (const card of deck.cards) {
    if (isBasicLand(card)) continue;
    if (owns(ctx.ownedNames, card)) {
      owned++;
      if (prefer) notes.push({ name: card.name, value: OWNED_BONUS, note: 'you own it' });
      continue;
    }
    const price = parseFloat(getCardPrice(card, currency) ?? '');
    if (!Number.isFinite(price) || price <= 0) continue;
    spend += price;
    notes.push({
      name: card.name,
      value: -price / rate,
      note: `buy for ${price.toFixed(2)} ${currency}`,
    });
  }
  const value = notes.reduce((s, n) => s + n.value, 0);
  return {
    value,
    summary: `buy ${spend.toFixed(2)} ${currency} at ${round2(rate)} per card-equivalent; ${owned} owned${prefer ? ` (+${OWNED_BONUS} each)` : ''}`,
    cards: notes,
  };
};
