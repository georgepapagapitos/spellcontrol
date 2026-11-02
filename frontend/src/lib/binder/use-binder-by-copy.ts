import { useEffect, useMemo, useState } from 'react';
import { materializeBinders } from './materialize';
import { useBinderLayoutInputs } from './use-binder-layout-inputs';
import type { BinderDef, EnrichedCard } from '@/types/index';
import type { SetMap } from '@/lib/api';

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
  allocatedCopyIds: ReadonlySet<string>,
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
  // BinderPage's own inputs: a raw-cards copy of this chain ignored tag,
  // Secret Lair and release-date routing, so a badge could name a binder the
  // card is not in.
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  return useMemo(
    () => buildBinderByCopyId(cards, binders, allocatedCopyIds, setMap),
    [cards, binders, allocatedCopyIds, setMap]
  );
}

const EMPTY_BY_COPY: Map<string, BinderRef[]> = new Map();

/**
 * {@link useBinderByCopyId} for a surface that paints without it: the same map,
 * but the materialize pass runs from an idle callback after first paint, not
 * inside the render. The deck editor's badge and the add-cards binder chip fill
 * in a beat later; until then the map is empty, and while inputs change the
 * previous map stays put instead of flashing empty. On a ~10k-card collection
 * the pass is about a second of phone-class main thread that otherwise sat in
 * front of the deck's first paint (E1049, O16).
 */
export function useBinderByCopyIdAfterPaint(): Map<string, BinderRef[]> {
  const { cards, binders, allocatedCopyIds, setMap } = useBinderLayoutInputs();
  const [byCopy, setByCopy] = useState(EMPTY_BY_COPY);
  useEffect(() => {
    // An empty result over an empty map keeps the same reference, so a qty edit
    // that moves nothing doesn't cost the editor a second render.
    const compute = () =>
      setByCopy((prev) => {
        const next = buildBinderByCopyId(cards, binders, allocatedCopyIds, setMap);
        return next.size === 0 && prev.size === 0 ? prev : next;
      });
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(compute);
      return () => window.cancelIdleCallback(handle);
    }
    const t = window.setTimeout(compute, 0);
    return () => window.clearTimeout(t);
  }, [cards, binders, allocatedCopyIds, setMap]);
  return byCopy;
}
