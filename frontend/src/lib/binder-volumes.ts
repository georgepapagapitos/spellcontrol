/**
 * Volumes: when a binder's cards outgrow its own fixed capacity, it reads as
 * several physical books instead of one. The engine (`planVolumes`,
 * `@spellcontrol/binder-routing`) is pure and re-derives volumes from an
 * already-materialized binder every time — there is no `BinderDef` field for
 * this and none is wanted (board E494: "ONE rule set, N physical books").
 * This shim is the ONE place every surface asks the question, so a hero line,
 * a page viewer and an index tile can't disagree about how many books a
 * binder needs.
 */
import {
  planVolumes,
  smallestFittingCapacity,
  standardBinderSizes,
} from '@spellcontrol/binder-routing';
import type { MaterializedBinder, Volume } from '../types';

export type { Volume };
export { smallestFittingCapacity, standardBinderSizes };

/**
 * Volumes for an already-materialized binder, or `null` when it has no fixed
 * capacity. **Call only with a binder materialized from an unfiltered pass
 * (`search: ''`)** — BinderPage's own materialize call is, so its result is
 * always safe to pass here; a search-narrowed result would under-count pages.
 */
export function volumesFor(
  binder: Pick<MaterializedBinder, 'def' | 'sections' | 'effectivePocketSize'>
): Volume[] | null {
  return planVolumes(binder.sections, {
    capacityCards: binder.def.fixedCapacity,
    pocketSize: binder.effectivePocketSize,
  });
}

/** True only when a binder is physically more than one book. */
export function hasMultipleVolumes(volumes: Volume[] | null): volumes is Volume[] {
  return volumes !== null && volumes.length > 1;
}

/**
 * Which volume a page falls in, or `undefined` when the binder fits in one
 * book — so a caller never has to special-case "Vol 1" out of its own output.
 */
export function pageVolume(volumes: Volume[] | null, pageNum: number): number | undefined {
  if (!hasMultipleVolumes(volumes)) return undefined;
  return volumes.find((v) => pageNum >= v.pageStart && pageNum <= v.pageEnd)?.index;
}
