import { useMemo } from 'react';
import { decorateWithSpareCopies } from '@spellcontrol/binder-routing';
import type { BinderDef, BinderFilterGroup, EnrichedCard } from '@/types/index';

/**
 * Gate for the `spareCopies` decoration pass (E495/E473) — mirrors
 * `bindersUseTags`/`groupsUseTags`: only pay for the collection-wide
 * spare-copy computation when a rule actually reads it.
 */
export function groupsUseSpareCopies(groups: BinderFilterGroup[]): boolean {
  return groups.some((g) => g.filter?.spareCopies !== undefined);
}

export function bindersUseSpareCopies(binders: BinderDef[]): boolean {
  return binders.some((b) => groupsUseSpareCopies(b.filterGroups));
}

/**
 * `cards` decorated with `.spareCopy` when `active`, otherwise returned by
 * reference (zero cost). Unlike tags/sldDrops/releaseDates, this needs no
 * async snapshot load — `computeSpareCopyIds` is synchronous and pure over
 * `cards` + `allocatedCopyIds`, both already in memory — so there is no
 * "ready" state to track, just a memo keyed on the same inputs.
 */
export function useCardsWithSpareCopies(
  cards: EnrichedCard[],
  allocatedCopyIds: ReadonlySet<string>,
  active: boolean
): EnrichedCard[] {
  return useMemo(
    () => (active ? decorateWithSpareCopies(cards, allocatedCopyIds) : cards),
    [cards, allocatedCopyIds, active]
  );
}
