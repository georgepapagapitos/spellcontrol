import type { Pacing } from './pacingDetector';
import { estimatePacingFromStats } from './roleTargets';

/**
 * Color-shortfall thresholds (explainability, not science).
 *
 * The "Mana base" readout flags a color as "Sources short" when it has real pip
 * demand but its sources cover too little of it. The base rule of thumb is "at
 * least 60% coverage, and only nag once demand is non-trivial (>= 3 pips)" — but
 * a deck's *pacing* should move that line: an aggressive deck must hit its colors
 * on curve, so it's judged stricter (higher coverage bar, flags smaller splashes),
 * while a late-game deck has more turns to find sources, so it's more forgiving.
 *
 * Pacing is derived from the deck's own mana curve via the generator's
 * `estimatePacingFromStats` — the same entry point `curveGrading.gradeCurve` uses,
 * so the two analyses agree on what kind of deck this is. This mirrors #435's
 * pacing-aware curve grades; `curveGrading.ts` is the template.
 */

/** The base coverage bar: flag short when sources cover < 60% of demand. */
export const BASE_SHORTFALL_RATIO = 0.6;
/** Base splash forgiveness: below this many colored pips a single source covers
 *  the demand, so we don't flag (zero-source colors flag regardless). */
export const BASE_MIN_FLAG_DEMAND = 3;

/** Ratio is clamped to this range after pacing scaling, so a future multiplier
 *  retune can't produce a nonsensical bar (>= 1 would flag fully-covered colors). */
const RATIO_MIN = 0.3;
const RATIO_MAX = 0.9;

export interface ShortfallThresholds {
  ratio: number;
  minDemand: number;
}

/**
 * Per-pacing relative adjustments on the base thresholds (balanced = midrange =
 * 1.0, so those reproduce today's static 0.6 / 3). `ratio` > 1 raises the
 * coverage bar (stricter); `minDemand` < 1 flags smaller splashes.
 */
export const PACING_SHORTFALL_MULTIPLIERS: Record<Pacing, { ratio: number; minDemand: number }> = {
  'aggressive-early': { ratio: 1.17, minDemand: 0.67 }, // ~0.70 / 2 — strict, flags splashes
  'fast-tempo': { ratio: 1.08, minDemand: 1.0 }, // ~0.65 / 3
  balanced: { ratio: 1.0, minDemand: 1.0 }, // 0.60 / 3 — base
  midrange: { ratio: 1.0, minDemand: 1.0 }, // 0.60 / 3 — base
  'late-game': { ratio: 0.83, minDemand: 1.33 }, // ~0.50 / 4 — forgiving
};

/**
 * Scale the base thresholds by a pacing, clamping the ratio to a sane band and
 * rounding the demand floor to an integer >= 1.
 */
export function pacingAwareShortfallThresholds(pacing: Pacing): ShortfallThresholds {
  const m = PACING_SHORTFALL_MULTIPLIERS[pacing] ?? PACING_SHORTFALL_MULTIPLIERS.balanced;
  const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, BASE_SHORTFALL_RATIO * m.ratio));
  const minDemand = Math.max(1, Math.round(BASE_MIN_FLAG_DEMAND * m.minDemand));
  return { ratio, minDemand };
}

/**
 * Derive pacing from a deck's mana curve, then its shortfall thresholds. An empty
 * curve yields `balanced` (base thresholds), so a missing curve is a no-op.
 */
export function shortfallThresholdsForCurve(
  manaCurve: Record<number, number>
): ShortfallThresholds & { pacing: Pacing } {
  const pacing = estimatePacingFromStats(manaCurve);
  return { pacing, ...pacingAwareShortfallThresholds(pacing) };
}

/**
 * Whether a color is "short": it has demand, its sources cover less than the
 * ratio of that demand, and either it has zero sources (always flag — you
 * literally can't produce it) or its demand clears the splash-forgiveness floor.
 */
export function isColorShort(
  demand: number,
  production: number,
  { ratio, minDemand }: ShortfallThresholds
): boolean {
  return demand > 0 && production < demand * ratio && (production === 0 || demand >= minDemand);
}
