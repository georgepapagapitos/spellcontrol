// Inclusion:lift pick blend (E1038 roadmap 2.4). On the held-out recall
// benchmark (frontend/scripts/recall-benchmark.mjs), `mix-2to1-inc-lift` took
// two picks by inclusion for every pick by EDHREC lift, skipping duplicates,
// and beat the generator's own scorer on recall@20 by +0.052 pooled
// [+0.018, +0.089] over pre-registered seeds 2 to 4 (#3036, #3038). Lift
// reserves a third of the slots, so it recovers tail cards that a
// popularity-ordered list never reaches.
//
// This is the same walk over the picker's candidate list: the existing order
// (priority with every boost and tie-break) is the "inclusion" lane, the cards
// carrying EDHREC lift signal ordered by cluster score are the "lift" lane.
// Every gate (role caps, budget, bracket, colors, collection) runs after this
// in processCards, so the blend only changes which candidate is tried first.
//
// One switch: LIFT_BLEND_ENABLED = false restores the pre-blend order exactly.

export const LIFT_BLEND_ENABLED = true;

/** Lane order per slot: 0 = existing priority order, 1 = lift order. 2:1. */
export const LIFT_BLEND_PATTERN: readonly number[] = [0, 0, 1];

/**
 * Slot-reserving merge of best-first lists: walk `pattern` (list indexes),
 * taking each list's next entry not already placed, until every list is
 * spent. A spent list's slot passes to the first list that still has entries.
 * Mirrors `interleave` in scripts/recall-benchmark-lib.mjs.
 */
export function interleaveLanes<T>(
  lists: readonly (readonly T[])[],
  pattern: readonly number[]
): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  const pos = lists.map(() => 0);
  const next = (i: number): T | undefined => {
    const list = lists[i];
    while (pos[i] < list.length && seen.has(list[pos[i]])) pos[i]++;
    return pos[i] < list.length ? list[pos[i]++] : undefined;
  };
  for (let step = 0; ; step++) {
    let item = next(pattern[step % pattern.length]);
    for (let j = 0; item === undefined && j < lists.length; j++) item = next(j);
    if (item === undefined) break;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Reorder `candidates` (best-first) so lift picks hold a third of the slots.
 * `liftScoreOf` returns the lift cluster score, 0 or less for no signal;
 * `exempt` keeps a candidate out of the lift lane (it still keeps its place in
 * the existing order). Returns the input untouched when the blend is off, at
 * the pure-Staples end of the dial (a play-rate-only ranking by definition),
 * or when no candidate has lift signal.
 */
export function blendWithLift<T>(
  candidates: readonly T[],
  liftScoreOf: (c: T) => number,
  brewLevel: number,
  exempt?: (c: T) => boolean,
  enabled: boolean = LIFT_BLEND_ENABLED
): readonly T[] {
  if (!enabled || brewLevel <= 0) return candidates;
  const lane = candidates
    .map((c, i) => ({ c, i, s: exempt?.(c) ? 0 : liftScoreOf(c) }))
    .filter((e) => e.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((e) => e.c);
  if (lane.length === 0) return candidates;
  return interleaveLanes([candidates, lane], LIFT_BLEND_PATTERN);
}
