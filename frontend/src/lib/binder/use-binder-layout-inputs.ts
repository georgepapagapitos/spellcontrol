import { useMemo } from 'react';
import { useCollectionStore } from '@/store/collection';
import { useCardsWithTags, bindersUseTags } from '@/lib/cards/card-tags';
import { useCardsWithSldDrops, bindersUseSldDrops } from '@/lib/cards/sld-drops';
import { useCardsWithReleaseDates, bindersUseReleaseDates } from '@/lib/cards/card-release-dates';
import { useCardsWithSpareCopies, bindersUseSpareCopies } from './spare-copies';
import { useAllocations } from '@/lib/collection/allocations';
import { useSetMap, type SetMap } from '@/lib/api';
import type { BinderDef, EnrichedCard } from '@/types/index';

/**
 * Every input `materializeBinders` needs to lay out a binder exactly the way
 * `BinderPage` renders it, at BinderPage's DEFAULT view: "group printings"
 * off (a non-persisted toggle that starts off every session) and no in-binder
 * search. A caller predicting routing or reporting page numbers OUTSIDE
 * BinderPage (the Add-list row prediction, the post-import routing summary)
 * uses this hook so it can never drift from what BinderPage actually shows —
 * see `project_add_cards_redesign` / board E457.
 */
export interface BinderLayoutInputs {
  /** Decorated with oracle tags, Secret Lair drops and per-printing release
   *  dates — the same chain BinderPage runs `rawCards` through, so a tag rule
   *  or a release-date sort resolves identically here and there. */
  cards: EnrichedCard[];
  binders: BinderDef[];
  /** copyIds currently allocated to a deck/cube — a `hideDeckAllocated:false`
   *  binder swallows these. */
  allocatedCopyIds: ReadonlySet<string>;
  /** Scryfall set metadata, for a binder sorted by release date. Undefined
   *  until it resolves (same as BinderPage's own first render). */
  setMap: SetMap | undefined;
}

/**
 * `rawCards` → tags → Secret Lair drops → release dates, plus the allocation
 * map and set map — exactly `pages/BinderPage.tsx`'s own chain, extracted so
 * there is one source of these inputs rather than each caller re-deriving
 * (and inevitably under-deriving) its own subset.
 */
export function useBinderLayoutInputs(): BinderLayoutInputs {
  const rawCards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);

  // No-op (returns its input by reference) unless a binder actually uses the
  // corresponding rule/sort — each decoration only costs what it's for.
  const taggedCards = useCardsWithTags(rawCards, bindersUseTags(binders));
  const droppedCards = useCardsWithSldDrops(taggedCards, bindersUseSldDrops(binders));
  const dateCards = useCardsWithReleaseDates(droppedCards, bindersUseReleaseDates(binders));
  // Last in the chain: needs `allocatedCopyIds`, computed above.
  const cards = useCardsWithSpareCopies(
    dateCards,
    allocatedCopyIds,
    bindersUseSpareCopies(binders)
  );

  const setMap = useSetMap();

  // Stable reference when nothing changed, so a caller that memoizes on the
  // whole object (rather than destructuring each field into its own
  // dependency, the way BinderPage does) doesn't recompute every render.
  return useMemo(
    () => ({ cards, binders, allocatedCopyIds, setMap }),
    [cards, binders, allocatedCopyIds, setMap]
  );
}
