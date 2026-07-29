// Zone-aware quantity-stepper math (E175). Pure diff between a zone's
// current stack for one card and a desired quantity — the mainboard qty
// stepper (#1340) had this logic hard-wired to `deck.cards`; this is the
// same math lifted out so main/sideboard/considering can all call it against
// whichever zone's slot array they mean to edit. The caller decides the zone
// by which array it passes in — this function never assumes mainboard, so it
// can't silently mutate the wrong zone.
import type { DeckCard } from '../store/decks';
import { pickSlotsToRelease } from './allocations';

export interface QtyPlan {
  /** New slots to add. 0 when unchanged or a decrement. */
  addCount: number;
  /** Slots to remove, unallocated-first (see pickSlotsToRelease). Empty when
   *  unchanged or an increment. */
  remove: DeckCard[];
}

/**
 * `current`: every slot for this card already in the target zone.
 * `qty`: absolute target count, or a delta when `opts.relative`.
 * `maxCopies`: format copy-limit ceiling for an increment; omit for a zone
 * with no such limit (e.g. Considering, a staging area, not a real deck zone).
 */
export function planQtyChange(
  current: DeckCard[],
  qty: number,
  opts?: { relative?: boolean },
  maxCopies?: number
): QtyPlan {
  let delta = opts?.relative ? qty : qty - current.length;
  if (delta > 0 && maxCopies !== undefined) {
    delta = Math.min(delta, Math.max(maxCopies - current.length, 0));
  }
  if (delta === 0) return { addCount: 0, remove: [] };
  if (delta > 0) return { addCount: delta, remove: [] };
  return { addCount: 0, remove: pickSlotsToRelease(current, -delta) };
}
