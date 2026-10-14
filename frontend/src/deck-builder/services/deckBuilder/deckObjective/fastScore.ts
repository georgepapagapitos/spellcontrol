import type { ScryfallCard } from '@/deck-builder/types';
import { TERMS } from './index';
import { TERM_KEYS, type ObjectiveContext, type ObjectiveDeck, type TermKey } from './types';

/** The two terms that simulate games; everything else is cheap. */
export const SLOW_TERMS: readonly TermKey[] = ['mana', 'winline'];
export const FAST_TERMS: readonly TermKey[] = TERM_KEYS.filter((k) => !SLOW_TERMS.includes(k));

/**
 * What each card adds to `deck` by the fast terms, scored apart: the
 * optimizer's own per-step gain estimate, for a caller that has to choose which
 * candidates are worth handing it.
 */
export function fastGains(
  deck: ObjectiveDeck,
  cards: readonly ScryfallCard[],
  ctx: ObjectiveContext
): Map<string, number> {
  const c = { ...ctx, slotOrder: deck.cards.map((x) => x.name) };
  const now = partialTotal(deck, c, FAST_TERMS);
  const out = new Map<string, number>();
  for (const card of cards) {
    const withCard = { commanders: deck.commanders, cards: [...deck.cards, card] };
    out.set(card.name, partialTotal(withCard, c, FAST_TERMS) - now);
  }
  return out;
}

/** Σ weight × value over some terms. */
export function partialTotal(
  deck: ObjectiveDeck,
  ctx: ObjectiveContext,
  keys: readonly TermKey[]
): number {
  let t = 0;
  for (const k of keys) if (ctx.weights[k] !== 0) t += ctx.weights[k] * TERMS[k](deck, ctx).value;
  return t;
}
