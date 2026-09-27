// Shopping list: cards you don't own that would most improve a saved cube if
// bought, ranked by the score change from swapping each one in for one of the
// cube's own weakest unlocked picks in the same color bucket.
//
// Each row proposes a DIFFERENT pick to replace: within a bucket, candidates
// are matched one-to-one against unlocked picks, best candidate to weakest
// pick, next-best to next-weakest, and so on (a bucket with more candidates
// than unlocked picks leaves the extras unranked — there's nothing left for
// them to replace). That makes the whole list the cost of a set of swaps that
// could all happen together, rather than N takes on the same one slot.
//
// Read-only over the objective scorer — this module calls `createScorerState`
// + `evalSwap` and NEVER `applySwap`, so ranking a few hundred candidates never
// mutates the saved cube. It is the ONE place shopping-list ranking touches
// scorer-state, so a later change to that module's shape only needs updating
// here (see the T150 W4 lane contract).
//
// Candidate SELECTION — which unowned cards are worth scoring at all (cube
// popularity, format eligibility, oracle-facts lookup) — is the caller's job;
// see pages/cube/CubeShoppingList.tsx. This module only ranks whatever pool of
// candidates it's handed, so it stays pure and testable without a network or
// the loaded cube-signal/otag snapshots.

import { bucketOf, type CubeCard } from './core';
import type { GeneratedCube, Pick } from './generate';
import { targetsForSize, type ColorBucket } from './targets';
import { computePowerBasis, rawPower } from './objective';
import { createScorerState, evalSwap } from './scorer-state';

export interface ShoppingRow {
  card: CubeCard;
  /** The cube's own weakest unlocked pick in this card's bucket — what buying
   *  and swapping in `card` would replace. */
  replaces: Pick;
  /** Objective-score gain (same 0..1 scale as `CubeScore.total`) from that one swap. Always > 0. */
  improvement: number;
}

export interface ShoppingListOptions {
  /** oracleIds locked in the cube — their pick is never named as a replacement. */
  lockedOracleIds?: ReadonlySet<string>;
  /** oracleIds already owned — never listed as a candidate to buy. */
  ownedOracleIds?: ReadonlySet<string>;
  /** oracleIds banned on this cube — never listed as a candidate. */
  bannedOracleIds?: ReadonlySet<string>;
  /** The cube's own synergy level (0..1) — the same basis `rescoreIfPossible` scores with. Defaults to 0 (a Power cube). */
  synergyLevel?: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Rank `candidates` by how much each would improve `cube` if it replaced one
 * of the weakest unlocked picks in its color bucket — each row a different
 * pick, matched by descending candidate power against ascending pick power
 * (see the module header). Only positive improvements are returned, best
 * first (oracleId tiebreak for determinism).
 */
export function buildShoppingList(
  candidates: CubeCard[],
  cube: GeneratedCube,
  pool: CubeCard[],
  options: ShoppingListOptions = {}
): ShoppingRow[] {
  const locked = options.lockedOracleIds ?? EMPTY_SET;
  const owned = options.ownedOracleIds ?? EMPTY_SET;
  const banned = options.bannedOracleIds ?? EMPTY_SET;
  const synergyLevel = options.synergyLevel ?? 0;

  const inCube = new Set(cube.picks.map((p) => p.card.oracleId));
  const eligible = candidates.filter(
    (c) => !owned.has(c.oracleId) && !banned.has(c.oracleId) && !inCube.has(c.oracleId)
  );
  if (eligible.length === 0) return [];

  const format = cube.format ?? 'limited';
  const band = targetsForSize(cube.size, format);
  const basis = computePowerBasis(pool);
  const state = createScorerState(cube.picks, pool, band, cube.size, basis, synergyLevel);
  const baseline = state.terms.total;
  const power = (c: CubeCard) => rawPower(c, basis);

  // Unlocked pick indices per bucket, weakest first — each is claimed by at
  // most one candidate below.
  const picksByBucket = new Map<ColorBucket, number[]>();
  cube.picks.forEach((p, index) => {
    if (locked.has(p.card.oracleId)) return;
    const bucket = bucketOf(p.card);
    const list = picksByBucket.get(bucket);
    if (list) list.push(index);
    else picksByBucket.set(bucket, [index]);
  });
  for (const list of picksByBucket.values()) {
    list.sort(
      (a, b) =>
        power(cube.picks[a].card) - power(cube.picks[b].card) ||
        cube.picks[a].card.oracleId.localeCompare(cube.picks[b].card.oracleId)
    );
  }

  // Eligible candidates per bucket, strongest first.
  const candidatesByBucket = new Map<ColorBucket, CubeCard[]>();
  for (const c of eligible) {
    const bucket = bucketOf(c);
    const list = candidatesByBucket.get(bucket);
    if (list) list.push(c);
    else candidatesByBucket.set(bucket, [c]);
  }

  const rows: ShoppingRow[] = [];
  for (const [bucket, bucketCandidates] of candidatesByBucket) {
    const picks = picksByBucket.get(bucket);
    if (!picks || picks.length === 0) continue;
    const ordered = [...bucketCandidates].sort(
      (a, b) => power(b) - power(a) || a.oracleId.localeCompare(b.oracleId)
    );
    const claimCount = Math.min(ordered.length, picks.length);
    for (let i = 0; i < claimCount; i++) {
      const pickIndex = picks[i];
      const card = ordered[i];
      const improvement = evalSwap(state, pickIndex, card).terms.total - baseline;
      if (improvement > 0) rows.push({ card, replaces: cube.picks[pickIndex], improvement });
    }
  }

  rows.sort(
    (a, b) => b.improvement - a.improvement || a.card.oracleId.localeCompare(b.card.oracleId)
  );
  return rows;
}
