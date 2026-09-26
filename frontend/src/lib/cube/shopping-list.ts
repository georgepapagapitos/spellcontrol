// Shopping list: cards you don't own that would most improve a saved cube if
// bought, ranked by the score change from swapping each one in for the
// cube's own weakest unlocked pick in the same color bucket.
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
 * Rank `candidates` by how much each would improve `cube` if it replaced the
 * weakest unlocked pick in its color bucket. A candidate whose bucket has no
 * unlocked pick (every pick there is locked, or the bucket is empty) is left
 * out — there's nothing for it to replace. Only positive improvements are
 * returned, best first (oracleId tiebreak for determinism).
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

  // The weakest unlocked pick per bucket (lowest raw power), computed once and
  // reused for every candidate that lands in that bucket.
  const weakest = new Map<ColorBucket, { index: number; power: number }>();
  cube.picks.forEach((p, index) => {
    if (locked.has(p.card.oracleId)) return;
    const bucket = bucketOf(p.card);
    const power = rawPower(p.card, basis);
    const cur = weakest.get(bucket);
    if (!cur || power < cur.power) weakest.set(bucket, { index, power });
  });

  const rows: ShoppingRow[] = [];
  for (const card of eligible) {
    const target = weakest.get(bucketOf(card));
    if (!target) continue;
    const improvement = evalSwap(state, target.index, card).terms.total - baseline;
    if (improvement > 0) rows.push({ card, replaces: cube.picks[target.index], improvement });
  }

  rows.sort(
    (a, b) => b.improvement - a.improvement || a.card.oracleId.localeCompare(b.card.oracleId)
  );
  return rows;
}
