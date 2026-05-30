import type { ScryfallCard } from '@/deck-builder/types';
import type { CurvePhaseAnalysis, RoleDeficit } from './deckAnalyzer';
import { computeMisfits, computeCardFitSubscore, type MisfitInputs } from './cardFit';

export type SubScoreKey = 'strategy' | 'roles' | 'tempo' | 'cardFit';

export interface SubScore {
  /** 0-100 */
  value: number;
  /** Short user-facing description shown on the dashboard tile. Data-grounded. */
  surface: string;
  /** Grade band label, e.g. "Healthy", "Thin". */
  bandLabel: string;
  /** When true, the score is partial because data was missing — dropped from the composite. */
  partial?: boolean;
}

export interface PlanScore {
  /** 0-100 weighted composite of the non-partial sub-scores. */
  overall: number;
  bandLabel: string;
  headline: string;
  byline: string;
  subscores: Record<SubScoreKey, SubScore>;
  /** True when any sub-score was partial (excluded from the composite). */
  limitedData: boolean;
}

// ── Bands & copy ──────────────────────────────────────────────────────────────
export function bandFor(score: number): string {
  if (score >= 90) return 'Tuned';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Solid';
  if (score >= 40) return 'Rough';
  return 'Thin';
}

export function headlineFor(score: number): string {
  if (score >= 90) return 'Your deck is performing optimally.';
  if (score >= 75) return 'Your deck is performing well, with a little room to grow.';
  if (score >= 60) return 'Your deck is solid, with clear room for improvement.';
  if (score >= 40) return 'Your deck has the foundation, but needs some tuning.';
  return 'Your deck is missing key pieces of its plan.';
}

// ── Shared ratio scoring ────────────────────────────────────────────────────
// current/target ratio, capped at 1.2, with a light overshoot half-penalty.
function normalizedRatio(current: number, target: number): number {
  const ratio = Math.min(1.2, current / (target || 1));
  return ratio >= 1 ? 1 - Math.max(0, ratio - 1) * 0.5 : ratio;
}

// ── Strategy ────────────────────────────────────────────────────────────────
const STRATEGY_DENSITY_TARGET = 0.3; // 30% of non-land cards reinforcing the plan = full marks
const STRATEGY_COVERAGE_TARGET_TOP_N = 60; // overlap-with-top-60 of theme bucket
const STRATEGY_COVERAGE_FULL_MARKS_HIT_RATE = 0.33; // 33% of top-N overlap = 100
const STRATEGY_COVERAGE_MIN_DENOMINATOR = 20; // floor so small theme buckets aren't trivial

export interface StrategyInputs {
  /** Non-land deck cards (excluding commander). */
  nonLandCards: ScryfallCard[];
  /** Lowercased card name → true for cards in any active theme bucket. */
  themeByCard: Set<string>;
  /** Top EDHREC theme cards (names), most-popular first. Optional. */
  topThemeCardNames?: string[];
  /** Display name of the detected plan, e.g. "+1/+1 Counters". */
  planName?: string | null;
}

export function computeStrategySubscore(inputs: StrategyInputs | null | undefined): SubScore {
  if (!inputs || inputs.themeByCard.size === 0) {
    return {
      value: 0,
      surface: 'No clear plan detected — set a theme to score strategy.',
      bandLabel: 'Unscored',
      partial: true,
    };
  }

  const { nonLandCards, themeByCard, topThemeCardNames, planName } = inputs;
  const nonLandCount = nonLandCards.length || 1;

  // 1. Theme density: fraction of non-land cards that are in any selected theme.
  let inTheme = 0;
  for (const c of nonLandCards) {
    if (themeByCard.has(c.name.toLowerCase())) inTheme++;
  }
  const density = inTheme / nonLandCount;
  const densityScore = Math.min(1, density / STRATEGY_DENSITY_TARGET);

  // 2. Theme coverage: of the top-N EDHREC theme cards, how many do we run?
  let coverageScore = 0.5; // neutral when we have no theme-bucket data
  if (topThemeCardNames && topThemeCardNames.length > 0) {
    const topN = topThemeCardNames.slice(0, STRATEGY_COVERAGE_TARGET_TOP_N);
    const deckNames = new Set(nonLandCards.map((c) => c.name.toLowerCase()));
    let hits = 0;
    for (const name of topN) {
      if (deckNames.has(name.toLowerCase())) hits++;
    }
    const denom = Math.max(
      STRATEGY_COVERAGE_MIN_DENOMINATOR,
      topN.length * STRATEGY_COVERAGE_FULL_MARKS_HIT_RATE
    );
    coverageScore = Math.min(1, hits / denom);
  }

  // Composite: 60% density (deck-side commitment), 40% coverage (community alignment).
  const composite = densityScore * 0.6 + coverageScore * 0.4;
  const value = Math.round(composite * 100);

  const plan = planName ?? 'your plan';
  const verb = inTheme === 1 ? 'reinforces' : 'reinforce';
  const surface = `${inTheme} of ${nonLandCount} non-land cards ${verb} ${plan}`;
  return { value, surface, bandLabel: bandFor(value) };
}

// ── Strategy (native synergy engine) ─────────────────────────────────────────
// Preferred over the EDHREC-conformance version above: instead of "how much
// does this look like the average deck", it measures whether the deck has a
// real producer↔payoff engine and how committed + balanced it is. When no
// engine is detected (control, goodstuff, an archetype we don't model yet) it
// scores `partial` and drops out — honest, and it never punishes a deck for
// lacking a synergy engine it was never trying to build.
const ENGINE_DENSITY_TARGET = 0.3; // 30% of non-land cards in the engine = full marks
const ENGINE_BALANCE_TARGET = 0.4; // weaker half ≥ 40% of the stronger = full balance marks

export interface StrategyEngineInput {
  /** Label of the deck's primary engine axis, or null when none is detected. */
  primaryLabel: string | null;
  /** Producer / payoff counts on that primary axis. */
  primaryProducers: number;
  primaryPayoffs: number;
  /** Distinct deck cards participating in any invested axis. */
  engineCards: number;
  /** Non-land card count (density denominator). */
  nonLandCount: number;
}

export function computeStrategyFromEngine(input: StrategyEngineInput | null | undefined): SubScore {
  if (!input || !input.primaryLabel) {
    return {
      value: 50,
      surface: 'No producer/payoff engine detected — strategy not scored.',
      bandLabel: 'Unscored',
      partial: true,
    };
  }
  const { primaryLabel, primaryProducers: p, primaryPayoffs: o, engineCards, nonLandCount } = input;

  const density = engineCards / (nonLandCount || 1);
  const densityScore = Math.min(1, density / ENGINE_DENSITY_TARGET);

  const balance = Math.min(p, o) / Math.max(p, o, 1);
  const balanceScore = Math.min(1, balance / ENGINE_BALANCE_TARGET);

  const value = Math.round((densityScore * 0.6 + balanceScore * 0.4) * 100);
  const surface = `${engineCards} of ${nonLandCount} non-land cards drive your ${primaryLabel} engine (${p} producer${p === 1 ? '' : 's'} / ${o} payoff${o === 1 ? '' : 's'}).`;
  return { value, surface, bandLabel: bandFor(value) };
}

// ── Roles ───────────────────────────────────────────────────────────────────
const ROLE_WEIGHTS: Record<string, number> = {
  ramp: 1.0,
  removal: 1.0,
  boardwipe: 0.7, // wipes are important but variance-heavy
  cardDraw: 1.0,
};

const ROLE_LABELS: Record<string, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipes',
  cardDraw: 'card draw',
};

export interface RoleSlot {
  role: string;
  current: number;
  target: number;
}

/** Build role slots from role counts + targets (mirrors RoleDeficit current/target). */
export function roleSlotsFromCounts(
  roleCounts: Record<string, number>,
  roleTargets: Record<string, number>
): RoleSlot[] {
  const roles = new Set([...Object.keys(roleTargets), ...Object.keys(ROLE_WEIGHTS)]);
  return [...roles].map((role) => ({
    role,
    current: roleCounts[role] ?? 0,
    target: roleTargets[role] ?? 0,
  }));
}

/** Build role slots from the analyzer's RoleDeficit list. */
export function roleSlotsFromDeficits(deficits: RoleDeficit[]): RoleSlot[] {
  return deficits.map((d) => ({ role: d.role, current: d.current, target: d.target }));
}

export function computeRolesSubscore(slots: RoleSlot[]): SubScore {
  const scorable = slots.filter((s) => s.target > 0);
  if (scorable.length === 0) {
    return {
      value: 50,
      surface: 'No role targets available.',
      bandLabel: 'Unscored',
      partial: true,
    };
  }

  let weighted = 0;
  let weightTotal = 0;
  const thin: string[] = [];

  for (const s of scorable) {
    const w = ROLE_WEIGHTS[s.role] ?? 0.5;
    weighted += normalizedRatio(s.current, s.target) * w;
    weightTotal += w;
    if (s.current < s.target * 0.7) thin.push(ROLE_LABELS[s.role] ?? s.role);
  }

  const value = Math.round((weighted / Math.max(1, weightTotal)) * 100);
  const surface =
    thin.length === 0
      ? 'All roles healthy.'
      : `Low on ${thin.slice(0, 2).join(' and ')}${thin.length > 2 ? ` (+${thin.length - 2})` : ''}.`;

  return { value, surface, bandLabel: bandFor(value) };
}

// ── Tempo ─────────────────────────────────────────────────────────────────
const PHASE_WEIGHTS: Record<string, number> = { early: 1.4, mid: 1.0, late: 0.7 };

export function computeTempoSubscore(curvePhases: CurvePhaseAnalysis[]): SubScore {
  const scorable = curvePhases.filter((p) => p.target > 0);
  if (scorable.length === 0) {
    return { value: 50, surface: 'No curve data available.', bandLabel: 'Unscored', partial: true };
  }

  let weighted = 0;
  let weightTotal = 0;
  let weakestPhase: string | null = null;
  let weakestRatio = Infinity;

  for (const phase of scorable) {
    const w = PHASE_WEIGHTS[phase.phase] ?? 1.0;
    const ratio = Math.min(1.2, phase.current / (phase.target || 1));
    weighted += normalizedRatio(phase.current, phase.target) * w;
    weightTotal += w;
    if (ratio < weakestRatio) {
      weakestRatio = ratio;
      weakestPhase = phase.phase;
    }
  }

  const value = Math.round((weighted / Math.max(1, weightTotal)) * 100);
  const surface = value >= 80 ? 'On curve.' : `Curve is light in the ${weakestPhase} game.`;
  return { value, surface, bandLabel: bandFor(value) };
}

// ── Composite ────────────────────────────────────────────────────────────────
const WEIGHTS: Record<SubScoreKey, number> = {
  strategy: 0.3,
  roles: 0.25,
  tempo: 0.2,
  cardFit: 0.25,
};

export interface PlanScoreInput {
  /** Role counts + targets — fed into the roles dimension. */
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  /** Curve-phase analysis (from getCurvePhases / DeckAnalysis.curvePhases) — tempo dimension. */
  curvePhases: CurvePhaseAnalysis[];
  /** Misfit inputs (deck cards, inclusion/synergy maps, gap candidates) — cardFit dimension. */
  misfitInputs: MisfitInputs;
  /** Count of high-value EDHREC gaps not in the deck — cardFit penalty. */
  gapCount: number;
  /**
   * Strategy inputs (theme membership + optional top-N theme cards). Omit/leave
   * null when no theme data is available — strategy then scores `partial` and is
   * dropped from the composite (graceful degrade until themes are wired).
   */
  strategy?: StrategyInputs | null;
  /**
   * Native-synergy strategy inputs. When provided (even as a no-engine value),
   * this is used for the strategy dimension instead of the EDHREC-conformance
   * `strategy` above. Preferred path.
   */
  strategyEngine?: StrategyEngineInput | null;
  /** Sample size for the byline (e.g. EDHREC numDecks). */
  sampleSize?: number | null;
}

/** Pure, isomorphic composite of the four PlanScore dimensions. */
export function computePlanScore(input: PlanScoreInput): PlanScore {
  const misfits = computeMisfits(input.misfitInputs);
  const cardFit = computeCardFitSubscore(misfits, input.gapCount);

  const subscores: Record<SubScoreKey, SubScore> = {
    strategy:
      input.strategyEngine !== undefined
        ? computeStrategyFromEngine(input.strategyEngine)
        : computeStrategySubscore(input.strategy),
    roles: computeRolesSubscore(roleSlotsFromCounts(input.roleCounts, input.roleTargets)),
    tempo: computeTempoSubscore(input.curvePhases),
    cardFit: { ...cardFit },
  };

  let weighted = 0;
  let weightTotal = 0;
  let limitedData = false;
  for (const k of Object.keys(subscores) as SubScoreKey[]) {
    const s = subscores[k];
    if (s.partial) {
      limitedData = true;
      continue;
    }
    weighted += s.value * WEIGHTS[k];
    weightTotal += WEIGHTS[k];
  }

  const overall = Math.round(weightTotal > 0 ? weighted / weightTotal : 0);
  const bandLabel = bandFor(overall);
  const headline = headlineFor(overall);
  const byline =
    input.sampleSize && input.sampleSize > 0
      ? `Based on ${input.sampleSize.toLocaleString()} decklists.`
      : 'Based on aggregated EDHREC data.';

  return { overall, bandLabel, headline, byline, subscores, limitedData };
}
