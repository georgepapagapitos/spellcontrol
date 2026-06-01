import type { Pacing } from './pacingDetector';
import { estimatePacingFromStats, PACING_CURVE_MULTIPLIERS } from './roleTargets';

/**
 * Curve grading (explainability, not science).
 *
 * A Commander curve is graded on each play-phase's share of nonland spells vs a
 * target band. The base band is front-loaded (Early 45% / Mid 35% / Late 20%),
 * but the deck's own pacing — derived from its curve via the generator's
 * `estimatePacingFromStats` — scales that band through `PACING_CURVE_MULTIPLIERS`
 * (the same model the generator targets), so an aggressive deck is judged against
 * a heavier-early band and a late-game deck against a heavier-late one, instead
 * of every deck against the same static 45/35/20.
 */

export type CurvePhaseKey = 'early' | 'mid' | 'late';

export interface CurvePhaseDef {
  key: CurvePhaseKey;
  label: string;
  /** CMCs that fall into this phase (7 = the 7+ bucket). Matches the buckets in
   *  estimatePacingFromStats (early ≤2 · mid 3-4 · late ≥5) so the two agree. */
  cmcs: number[];
}

export const CURVE_PHASES: CurvePhaseDef[] = [
  { key: 'early', label: 'Early', cmcs: [0, 1, 2] },
  { key: 'mid', label: 'Mid', cmcs: [3, 4] },
  { key: 'late', label: 'Late', cmcs: [5, 6, 7] },
];

/** The base band for a balanced Commander curve, before pacing adjustment. */
const BASE_PHASE_TARGET: Record<CurvePhaseKey, number> = { early: 0.45, mid: 0.35, late: 0.2 };

/** Human-readable pacing label for the curve caption. */
export const PACING_LABEL: Record<Pacing, string> = {
  'aggressive-early': 'aggressive',
  'fast-tempo': 'fast tempo',
  midrange: 'midrange',
  'late-game': 'late game',
  balanced: 'balanced',
};

/**
 * Phase share targets scaled by pacing and renormalized to sum 1, so they stay a
 * valid share distribution regardless of the multipliers.
 */
export function pacingAwarePhaseTargets(pacing: Pacing): Record<CurvePhaseKey, number> {
  const m = PACING_CURVE_MULTIPLIERS[pacing] ?? PACING_CURVE_MULTIPLIERS.balanced;
  const raw = {
    early: BASE_PHASE_TARGET.early * m.early,
    mid: BASE_PHASE_TARGET.mid * m.mid,
    late: BASE_PHASE_TARGET.late * m.late,
  };
  const sum = raw.early + raw.mid + raw.late || 1;
  return { early: raw.early / sum, mid: raw.mid / sum, late: raw.late / sum };
}

export function gradeFromDeviation(deviation: number): string {
  if (deviation <= 0.1) return 'A';
  if (deviation <= 0.2) return 'B';
  if (deviation <= 0.35) return 'C';
  if (deviation <= 0.55) return 'D';
  return 'F';
}

/**
 * Grade one phase against its target. Early/Mid penalize only being **under**
 * target (extra cheap/mid cards never hurt); Late is two-sided — top-heavy is the
 * classic Commander mistake — so it's penalized for deviating either way.
 */
export function gradePhase(key: CurvePhaseKey, share: number, target: number): string {
  if (target <= 0) return 'A';
  const raw = (target - share) / target; // >0 means under target
  const penalized = key === 'late' ? Math.abs(raw) : Math.max(0, raw);
  return gradeFromDeviation(penalized);
}

export interface CurvePhaseGrade extends CurvePhaseDef {
  count: number;
  share: number;
  target: number;
  grade: string;
}

export interface CurveGrading {
  pacing: Pacing;
  total: number;
  phases: CurvePhaseGrade[];
}

/** Grade each phase of a deck's mana curve against pacing-aware targets. */
export function gradeCurve(manaCurve: Record<number, number>): CurveGrading {
  const pacing = estimatePacingFromStats(manaCurve);
  const targets = pacingAwarePhaseTargets(pacing);
  const total = Object.values(manaCurve).reduce((s, v) => s + v, 0);
  const phases = CURVE_PHASES.map((phase) => {
    const count = phase.cmcs.reduce((s, cmc) => s + (manaCurve[cmc] ?? 0), 0);
    const share = total > 0 ? count / total : 0;
    const target = targets[phase.key];
    return { ...phase, count, share, target, grade: gradePhase(phase.key, share, target) };
  });
  return { pacing, total, phases };
}
