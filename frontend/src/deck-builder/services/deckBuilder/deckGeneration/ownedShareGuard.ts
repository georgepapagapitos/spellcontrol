/**
 * The partial owned share and the user's price bar, read live from the deck
 * (E571). The owned-share repair seats owned cards up to the user's share, but
 * the post-generation fixup (phasePostGenFixup.ts) runs after it and traded
 * three owned fillers for unowned removal in Lathril partial50, taking the deck
 * from 28 owned of 65 (43%) to 25 (38.5%), under the 45% floor.
 *
 * The rulings (2026-09-29): under a partial share below 100% an unowned card
 * takes an owned card's slot only when it is clearly better, and the bar rises
 * with its price (buyBar, the E509 ruling the whole-deck search's ownership
 * term already encodes: 8 inclusion points per price doubling past $2). At
 * 100% only a must-include breaks the share.
 */
import { getByCardName } from '@/lib/cards/card-text';
import { getCardPrice } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';
import { buyBar } from '../deckObjective/terms/ownership';
import type { GenerationState } from './state';

type ShareState = Pick<GenerationState, 'cfg' | 'categories' | 'edhrecData'> & {
  context: Pick<GenerationState['context'], 'collectionNames'>;
};

export interface OwnedShareGuard {
  /** Whether the name is in the user's collection (false when the build has none). */
  owned: (name: string) => boolean;
  /** A partial build whose owned nonland count is under the share it asked for. */
  short: () => boolean;
  /** A partial build at 100%: only a must-include breaks the share. */
  strict: boolean;
  /** Trading the owned `weak` for the unowned `incoming` is not allowed. */
  costsShare: (weak: ScryfallCard, incoming: ScryfallCard) => boolean;
  /** Whether an owned candidate is as good as the best, unowned one: the
   *  unowned one is not clearly better than it by the price bar. */
  ownedIsAsGood: (ownedCard: ScryfallCard, best: ScryfallCard) => boolean;
}

export function ownedShareGuard(state: ShareState): OwnedShareGuard {
  const names = state.context.collectionNames;
  const percent = state.cfg.collectionOwnedPercent;
  const partial = state.cfg.collectionStrategy === 'partial' && !!names && percent > 0;
  const owned = (name: string) => !!names?.has(name);
  const inclusion = new Map(
    (state.edhrecData?.cardlists.allNonLand ?? []).map((c) => [c.name, c.inclusion])
  );
  const inclusionOf = (card: ScryfallCard) => getByCardName(inclusion, card.name) ?? 0;
  const clearlyBetter = (incoming: ScryfallCard, other: ScryfallCard) => {
    const price = parseFloat(getCardPrice(incoming, state.cfg.currency) ?? '');
    const bar = 100 * buyBar(incoming, Number.isFinite(price) && price > 0 ? price : 0);
    return inclusionOf(incoming) - inclusionOf(other) >= bar;
  };
  const nonLand = () =>
    Object.entries(state.categories)
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);
  return {
    owned,
    strict: partial && percent >= 100,
    short: () => {
      if (!partial) return false;
      const cards = nonLand();
      return cards.filter((c) => owned(c.name)).length < Math.round((cards.length * percent) / 100);
    },
    costsShare: (weak, incoming) => {
      if (!partial || !owned(weak.name) || owned(incoming.name)) return false;
      return percent >= 100 || !clearlyBetter(incoming, weak);
    },
    ownedIsAsGood: (ownedCard, best) => percent >= 100 || !clearlyBetter(best, ownedCard),
  };
}
