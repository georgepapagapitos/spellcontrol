/**
 * The partial owned share, read live from the deck (E571). The owned-share
 * repair seats owned cards up to the user's share, but the repair is not the
 * last phase to move cards: the post-generation fixup (phasePostGenFixup.ts)
 * traded three owned fillers for unowned removal in Lathril partial50 and took
 * the deck from 28 owned of 65 (43%) to 25 (38.5%), under the 45% floor the
 * repair had reached for. A later phase keeps the share the repair left: below
 * the share it prefers an owned candidate, and does not cut an owned card for
 * an unowned one.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { GenerationState } from './state';

type ShareState = Pick<GenerationState, 'cfg' | 'categories'> & {
  context: Pick<GenerationState['context'], 'collectionNames'>;
};

export interface OwnedShareGuard {
  /** Whether the name is in the user's collection (false when the build has none). */
  owned: (name: string) => boolean;
  /** A partial build whose owned nonland count is under the share it asked for. */
  short: () => boolean;
  /** Trading `weak` for `incoming` would take the owned count under the share. */
  costsShare: (weak: ScryfallCard, incoming: ScryfallCard) => boolean;
}

export function ownedShareGuard(state: ShareState): OwnedShareGuard {
  const names = state.context.collectionNames;
  const percent = state.cfg.collectionOwnedPercent;
  const partial = state.cfg.collectionStrategy === 'partial' && !!names && percent > 0;
  const owned = (name: string) => !!names?.has(name);
  const nonLand = () =>
    Object.entries(state.categories)
      .filter(([cat]) => cat !== 'lands')
      .flatMap(([, cards]) => cards);
  const wanted = (total: number) => Math.round((total * percent) / 100);
  return {
    owned,
    short: () => {
      if (!partial) return false;
      const cards = nonLand();
      return cards.filter((c) => owned(c.name)).length < wanted(cards.length);
    },
    costsShare: (weak, incoming) => {
      if (!partial || !owned(weak.name) || owned(incoming.name)) return false;
      const cards = nonLand();
      return cards.filter((c) => owned(c.name)).length - 1 < wanted(cards.length);
    },
  };
}
