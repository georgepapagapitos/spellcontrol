// The one way the app computes a deck's average mana value, and the one pair
// of cutoffs every screen reads it against (E1078). Before this the Mana tile
// averaged raw MV, the curve verdict averaged MV rounded and capped at 7, the
// summary averaged the capped slot counts, and the validation checklist warned
// at 3.5 while the analysis called anything under 3.8 comfortable.
//
// A leaf on purpose: no imports, so the analysis, the checklist and the
// summary can all depend on it without forming a cycle (import-cycles test).
// Display buckets stay capped at 7 where they are drawn; the average never is.

/** At or above this average MV a deck reads as top-heavy, on every screen. */
export const TOP_HEAVY_AVG_MV = 3.8;
/** Below this average MV (and above 0) a deck reads as a fast, low curve. */
export const LOW_CURVE_AVG_MV = 2.5;

/**
 * Average mana value of a deck's nonland cards, uncapped and unrounded. The
 * caller decides what is a land (front face, so a spell//land MDFC counts as
 * a spell) and passes only the rest. A card with a missing or NaN value is
 * skipped, numerator and denominator both, as the curve buckets always did.
 */
export function averageNonlandMv(nonLandCards: ReadonlyArray<{ cmc?: number | null }>): number {
  let sum = 0;
  let n = 0;
  for (const c of nonLandCards) {
    const mv = c.cmc;
    if (typeof mv !== 'number' || Number.isNaN(mv)) continue;
    sum += mv;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/** The single top-heavy test the verdict, summary and checklist share. */
export function isTopHeavyAvgMv(avg: number): boolean {
  return avg >= TOP_HEAVY_AVG_MV;
}
