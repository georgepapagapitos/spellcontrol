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
// `smallestFittingCapacity` takes a PAGE count, not a card count — see its
// own doc in @spellcontrol/binder-routing for why a card-count comparison
// silently lies once a binder's sections start fresh pages.
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

/**
 * The volumes vocabulary (E494), one wording for every surface that says how
 * a binder splits into physical books: `BinderVolumesSheet`, the editor's
 * Pages disclosure and its preview. A phrase is built here, never retyped at
 * a second call site, so the surfaces can't drift apart.
 */

/** "binders of 360" (or "binder of 360"): the unit after a count. */
export function bindersOfCapacity(count: number, fixedCapacity: number): string {
  return `${count === 1 ? 'binder' : 'binders'} of ${fixedCapacity.toLocaleString()}`;
}

/** "4 binders of 360". */
export function volumesOfCapacity(count: number, fixedCapacity: number): string {
  return `${count.toLocaleString()} ${bindersOfCapacity(count, fixedCapacity)}`;
}

/** "1,105 cards need 4 binders of 360": the over-capacity fact. */
export function cardsNeedVolumes(volumes: Volume[], fixedCapacity: number): string {
  const cards = volumes.reduce((n, v) => n + v.cardCount, 0);
  return `${cards.toLocaleString()} ${cards === 1 ? 'card needs' : 'cards need'} ${volumesOfCapacity(
    volumes.length,
    fixedCapacity
  )}`;
}

/** "pp. 1–40" (or "p. 41"): the pages one volume holds. */
export function volumePageRange(v: Volume): string {
  return v.pageStart === v.pageEnd ? `p. ${v.pageStart}` : `pp. ${v.pageStart}–${v.pageEnd}`;
}

/** "White → Blue": the first and last section on one volume's spine. */
export function volumeSpine(v: Volume): string {
  return v.firstLabel === v.lastLabel ? v.firstLabel : `${v.firstLabel} → ${v.lastLabel}`;
}

/** The fix's button: "Use a 480-card binder". */
export function fitButtonLabel(size: number): string {
  return `Use a ${size.toLocaleString()}-card binder`;
}

/**
 * "No standard size holds it in one book, so it stays in N volumes.": the
 * plain answer when no marketed size fits (`smallestFittingCapacity` gave
 * null).
 */
export function noFitMessage(volumeCount: number): string {
  return `No standard size holds it in one book, so it stays in ${volumeCount} volumes.`;
}
