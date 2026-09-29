/**
 * Binder materialization lives in the isomorphic `@spellcontrol/binder-routing`
 * package (single source of truth, shared with the backend's shared-binder
 * projections). This shim keeps the import path stable and adds ONE thing the
 * package deliberately doesn't: a small identity-keyed memo.
 *
 * Every surface that needs "which binder holds this copy" (deck editor badges,
 * card locations, the review queue, pull lists, the binder editor's landing
 * count…) materializes the whole collection — ~11.5k cards sorted per binder,
 * ~100 ms on a desktop and 4× that on a phone (E276). The store arrays are
 * immutable (Zustand replaces the reference on every mutation), so a call with
 * the same `cards` / `defs` references and the same option values is the same
 * answer; re-mounting a page, or two surfaces asking in the same render, now
 * recomputes nothing. Results are treated as read-only by every caller.
 */
import {
  materializeBinders as compute,
  type MaterializeOptions,
} from '@spellcontrol/binder-routing';

export type { MaterializeOptions } from '@spellcontrol/binder-routing';

type Args = Parameters<typeof compute>;
type Result = ReturnType<typeof compute>;
interface Entry {
  cards: Args[0];
  defs: Args[1];
  opts: MaterializeOptions;
  result: Result;
}

const OPTION_KEYS: (keyof MaterializeOptions)[] = [
  'search',
  'uncategorizedSorts',
  'allocatedCopyIds',
  'setMap',
  'qtyByPrintingKey',
];
/** Most-recent-first; a handful covers every surface mounted at once. */
const recent: Entry[] = [];
const LIMIT = 4;

export function materializeBinders(cards: Args[0], defs: Args[1], opts: Args[2]): Result {
  const hit = recent.find(
    (e) => e.cards === cards && e.defs === defs && OPTION_KEYS.every((k) => e.opts[k] === opts[k])
  );
  if (hit) return hit.result;
  const result = compute(cards, defs, opts);
  recent.unshift({ cards, defs, opts: { ...opts }, result });
  if (recent.length > LIMIT) recent.length = LIMIT;
  return result;
}

export const __testing = { recent };
