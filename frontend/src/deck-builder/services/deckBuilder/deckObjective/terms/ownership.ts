/**
 * Ownership: what the deck costs THIS user, read from the build's collection
 * strategy. Zero for a build with no collection: the budget constraint caps
 * spend there, and cheaper isn't better inside it.
 *
 * Which cards may be unowned at all is a HARD constraint (constraints.ts):
 * none under "Only my cards" / "Available" (basics aside), at most 100 − N%
 * of the nonland cards under an N% owned share. This term is the user's
 * price bar inside those limits (E509 ruling, 2026-09-29): an unowned card
 * takes an owned candidate's slot only when it is clearly better, and the bar
 * rises with its price, one step per price doubling past $2
 * (collectionPriceBar.ts on the shelved E509 branch):
 *
 *   doublings = log2(1 + price / PRICE_BAR_FREE_USD)
 *   spell:  SPELL_BAR_PER_DOUBLING × doublings   (8 pick-priority points per
 *           doubling, about one inclusion point each: 0.08 card-equivalents)
 *   land:   LAND_BAR_BASE + LAND_BAR_PER_DOUBLING × doublings  (3 + 4 land
 *           points, read as 0.03 + 0.04: a land point is an inclusion point)
 *
 * so a $1 staple costs about 0.05 of a card, a $10 one 0.21, a $1,000 one
 * 0.72. Under "Lean on mine" (prefer) an owned card also earns OWNED_BONUS,
 * a quarter of a card: an owned card up to that much weaker keeps the slot.
 * That bonus is set a priori (the product's own prefer boost lives on the
 * generator's pick-priority scale, which does not convert 1:1).
 */
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import { frontFaceName } from '@/lib/card-text';
import type { ScryfallCard } from '@/deck-builder/types';
import type { CardNote, ObjectiveContext } from '../types';
import { isBasicLand, isLandCard } from '../context';
import { round2, type TermFn } from './shared';

export const PRICE_BAR_FREE_USD = 2;
export const SPELL_BAR_PER_DOUBLING = 0.08;
export const LAND_BAR_BASE = 0.03;
export const LAND_BAR_PER_DOUBLING = 0.04;
export const OWNED_BONUS = 0.25;

function owns(names: ReadonlySet<string>, card: ScryfallCard): boolean {
  return names.has(card.name) || names.has(frontFaceName(card.name));
}

export function priceDoublings(price: number): number {
  return price > 0 ? Math.log2(1 + price / PRICE_BAR_FREE_USD) : 0;
}

/** What buying this card costs in card-equivalents (the ruling's bar). */
export function buyBar(card: ScryfallCard, price: number): number {
  const d = priceDoublings(price);
  return isLandCard(card) ? LAND_BAR_BASE + LAND_BAR_PER_DOUBLING * d : SPELL_BAR_PER_DOUBLING * d;
}

/** A collection build: owned names given and collection mode on. */
export function isCollectionBuild(ctx: ObjectiveContext): boolean {
  return !!ctx.ownedNames && ctx.customization.collectionMode !== false;
}

export const ownershipTerm: TermFn = (deck, ctx) => {
  if (!isCollectionBuild(ctx) || !ctx.ownedNames) {
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
    const raw = parseFloat(getCardPrice(card, currency) ?? '');
    const price = Number.isFinite(raw) && raw > 0 ? raw : 0;
    spend += price;
    const bar = buyBar(card, price);
    if (bar <= 0) continue;
    notes.push({
      name: card.name,
      value: -bar,
      note: `buy for ${price.toFixed(2)} ${currency}: ${round2(priceDoublings(price))} price doublings`,
    });
  }
  const value = notes.reduce((s, n) => s + n.value, 0);
  return {
    value,
    summary: `buy ${spend.toFixed(2)} ${currency} of unowned cards; ${owned} owned${prefer ? ` (+${OWNED_BONUS} each)` : ''}`,
    cards: notes,
  };
};
