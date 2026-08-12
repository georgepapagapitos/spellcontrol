import { useMemo } from 'react';
import { useCollectionStore } from '../store/collection';
import { useAllocations } from './allocations';
import { materializeBinders } from './materialize';
import { useSetMap } from './api';
import type { BinderDef, EnrichedCard } from '../types';
import type { SetMap } from './api';

/** The shape `BinderBadge` takes — structural on purpose, so `lib/` never
 *  imports from `components/` (see the import-cycle guard). */
export interface BinderRef {
  id: string;
  name: string;
  color: string | null;
}

/**
 * Which binder(s) each physical copy sits in, keyed by `copyId`.
 *
 * Goes through `materializeBinders` rather than re-running rule matching, for
 * the same reason `buildCardLocationIndex` does: the answer has to agree with
 * what the user sees when they open the binder, including deck-allocation
 * hiding, pinned-card promotion and printing selection. Re-deriving membership
 * would silently disagree the moment one of those quirks applies.
 *
 * `allocatedCopyIds` is passed for the same reason: a binder that opts out of
 * showing deck-allocated cards (`hideDeckAllocated === false`) swallows those
 * copies, and this map has to agree. Note that is opt-IN — by default a copy
 * checked out to a deck still sits in its binder, so a row can legitimately
 * carry both badges: committed to that deck, filed in that binder.
 */
export function buildBinderByCopyId(
  cards: EnrichedCard[],
  defs: BinderDef[],
  allocatedCopyIds: Set<string>,
  setMap: SetMap | undefined
): Map<string, BinderRef[]> {
  const byCopy = new Map<string, BinderRef[]>();
  if (cards.length === 0 || defs.length === 0) return byCopy;

  const { binders } = materializeBinders(cards, defs, {
    search: '',
    allocatedCopyIds,
    setMap,
  });

  for (const b of binders) {
    const ref: BinderRef = { id: b.def.id, name: b.def.name, color: b.def.color ?? null };
    for (const section of b.sections) {
      for (const card of section.cards) {
        if (!card.copyId) continue;
        const existing = byCopy.get(card.copyId);
        if (!existing) byCopy.set(card.copyId, [ref]);
        else if (!existing.some((x) => x.id === ref.id)) existing.push(ref);
      }
    }
  }
  return byCopy;
}

/**
 * Hook form of {@link buildBinderByCopyId}.
 *
 * ⚠️ Call this ONCE per surface and pass the map down — materializing a
 * ~11.5k-card collection is not something a list of rows should pay per row.
 * (`DeckDisplay`/`DeckCardGrid` thread it as a `binderByCopyId` prop for the
 * same reason.)
 */
export function useBinderByCopyId(): Map<string, BinderRef[]> {
  const cards = useCollectionStore((s) => s.cards);
  const defs = useCollectionStore((s) => s.binders);
  const allocations = useAllocations();
  const setMap = useSetMap();

  return useMemo(
    () => buildBinderByCopyId(cards, defs, new Set(allocations.keys()), setMap),
    [cards, defs, allocations, setMap]
  );
}
