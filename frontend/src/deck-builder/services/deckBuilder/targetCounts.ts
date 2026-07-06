// Target-count computation: turns a Customization (+ optional EDHREC stats) into
// per-type and per-CMC slot targets, applying any advanced user overrides.
// Pure — extracted verbatim from deckGenerator.ts for isolation/testing.
import { logger } from '@/lib/logger';
import { Archetype } from '@/deck-builder/types';
import type {
  Customization,
  DeckComposition,
  EDHRECCommanderStats,
  Pacing,
} from '@/deck-builder/types';
import { calculateTypeTargets, calculateCurveTargets } from './curveUtils';

// Return type for calculateTargetCounts
export interface TargetCountsResult {
  composition: DeckComposition;
  typeTargets: Record<string, number>;
  curveTargets: Record<number, number>;
}

// ─── Auto Land-Count Adjustment ─────────────────────────────────────
// The flat 37-land default is a "goodstuff" number — it's wrong for
// elf-ball/tribal-dork decks (too many lands on top of 15-20 mana dorks) and
// for genuinely high-curve ramp decks (could use 1-2 more). Only applied when
// the user hasn't touched the land inputs (see isDefaultLandCount); an
// explicit user choice is never second-guessed.

// The flat "goodstuff" land-count baseline — single source of truth (was
// duplicated as a bare 37 literal in isDefaultLandCount and, before E88, in
// deckGenerator.ts's landCountNote copy).
export const DEFAULT_LAND_COUNT = 37;

/** True when landCount/nonBasicLandCount are both still at the store defaults
 *  — the only signal available that the user hasn't customized lands (no
 *  dirty flag is threaded through generation context). */
export function isDefaultLandCount(customization: Customization): boolean {
  return customization.landCount === DEFAULT_LAND_COUNT && customization.nonBasicLandCount === 15;
}

// Karsten's land-count formula (Frank Karsten, "How Many Lands Do You Need
// to Consistently Hit Your Land Drops", 2022) — a curve/ramp-driven linear
// model, replacing the old hand-tuned archetype-delta heuristic. Coefficients
// are the published formula; clamped to the same 32-40 sane band as before.
const KARSTEN_INTERCEPT = 31.42;
const KARSTEN_CMC_COEFFICIENT = 3.13;
const KARSTEN_RAMP_COEFFICIENT = 0.28;

/**
 * Karsten land-count formula: intercept + avgCmc slope − ramp-density slope,
 * clamped to a 32-40 sane band. `archetype` is unused by the formula itself
 * (kept for signature stability — every call site still passes it).
 * `rampDensity` is the deck's planned ramp-slot target (blended EDHREC +
 * archetype model, see `getDynamicRoleTargets(...).targets.ramp`) — a
 * pre-generation proxy for how much of the manabase the deck's own
 * dorks/rocks will cover.
 */
export function computeAutoLandCount(
  _archetype: Archetype,
  rampDensity: number,
  avgCmc: number
): number {
  return Math.max(
    32,
    Math.min(
      40,
      Math.round(
        KARSTEN_INTERCEPT +
          KARSTEN_CMC_COEFFICIENT * avgCmc -
          KARSTEN_RAMP_COEFFICIENT * rampDensity
      )
    )
  );
}

// Archetypes that lean go-wide/low-curve/dork-heavy and can safely run fewer
// lands — the pre-Karsten archetype-delta heuristic, recovered verbatim (was
// deleted whole by 30ab5e9a) for its ORIGINAL job: sizing typeTargetLandCount
// (nonLandCards), never the delivered land count.
const LAND_COUNT_ARCHETYPE_DELTA: Partial<Record<Archetype, number>> = {
  [Archetype.TRIBAL]: -1,
  [Archetype.AGGRO]: -1,
  [Archetype.VOLTRON]: -1,
  [Archetype.STORM]: -1,
  [Archetype.TEMPO]: -1,
  [Archetype.CONTROL]: 1,
  [Archetype.LANDFALL]: 1,
  [Archetype.REANIMATOR]: 1,
};

/**
 * SIZING-ONLY anchor for the type/curve passes — NOT a land-count decision.
 * Karsten (computeAutoLandCount above) now owns the delivered land count; but
 * lifting resolvedLandCount INSIDE the 32-40 band still flows straight into
 * typeTargetLandCount (`min(resolvedLandCount, anchor)`), silently shrinking
 * every type/curve pass's nonLandCards budget with zero disclosure or
 * protection — the >37 case is safe (phaseLandSqueezeReconcile discloses and
 * protects it), but a <=37 shrink bypassed that reconcile entirely (killed
 * Rhystic Study/Ugin/Skullclamp-class picks in the differ gate). This
 * function is the legacy archetype-delta heuristic, byte-identical to the
 * body computeAutoLandCount had before Karsten replaced it — its only job
 * now is anchoring pass sizing to that legacy-validated shape, so the entire
 * Karsten-vs-legacy delta (in EITHER direction) routes through the existing,
 * disclosed, protected squeeze reconcile instead of an invisible pass-sizing
 * shrink.
 */
export function computeLandCountSizingAnchor(
  archetype: Archetype,
  rampDensity: number,
  avgCmc: number
): number {
  let delta = LAND_COUNT_ARCHETYPE_DELTA[archetype] ?? 0;
  if (rampDensity >= 10) delta -= 2;
  else if (rampDensity >= 7) delta -= 1;

  if (avgCmc > 0 && avgCmc < 2.6) delta -= 1;
  else if (avgCmc >= 3.6) delta += 1;

  delta = Math.max(-5, Math.min(5, delta));
  return Math.max(32, Math.min(40, 37 + delta));
}

// Apply user's advanced target overrides (curve percentages, type percentages)
function applyAdvancedOverrides(
  customization: Customization,
  typeTargets: Record<string, number>,
  curveTargets: Record<number, number>,
  nonLandCards: number
): void {
  const adv = customization.advancedTargets;

  if (adv?.curvePercentages) {
    const pcts = adv.curvePercentages;
    const total = Object.values(pcts).reduce((s, v) => s + v, 0) || 100;
    let allocated = 0;
    const cmcKeys = Object.keys(pcts)
      .map(Number)
      .sort((a, b) => a - b);
    for (const cmc of cmcKeys) {
      curveTargets[cmc] = Math.round((pcts[cmc] / total) * nonLandCards);
      allocated += curveTargets[cmc];
    }
    const diff = nonLandCards - allocated;
    if (diff !== 0) {
      const largest = cmcKeys.reduce(
        (m, c) => (curveTargets[c] > curveTargets[m] ? c : m),
        cmcKeys[0]
      );
      curveTargets[largest] += diff;
    }
  }

  if (adv?.typePercentages) {
    const pcts = adv.typePercentages;
    const total = Object.values(pcts).reduce((s, v) => s + v, 0) || 100;
    let allocated = 0;
    for (const type of Object.keys(pcts)) {
      typeTargets[type] = Math.round((pcts[type] / total) * nonLandCards);
      allocated += typeTargets[type];
    }
    const diff = nonLandCards - allocated;
    if (diff !== 0) {
      typeTargets.creature = (typeTargets.creature ?? 0) + diff;
    }
  }
}

// Calculate target counts for each category based on EDHREC stats or fallback defaults
export function calculateTargetCounts(
  customization: Customization,
  edhrecStats?: EDHRECCommanderStats,
  hasPartner?: boolean,
  pacing?: Pacing,
  /** Archetype-aware auto land count (see computeAutoLandCount); only passed
   *  when the user hasn't customized land count. Overrides customization.landCount. */
  landCountOverride?: number,
  /** E88: land count used ONLY to size typeTargets/curveTargets (nonLandCards).
   *  Defaults to landCountOverride ?? customization.landCount (today's
   *  behavior) when omitted — every existing call site is unaffected. Only
   *  deckGenerator.ts's auto-tune branch passes a different (smaller) value,
   *  so the actual land-generation count (composition.lands, still `landCount`
   *  below) can raise independently of how many nonland slots the type passes
   *  are sized for — letting them pick their full, un-squeezed complement and
   *  leaving the resulting surplus for Smart Trim / phaseLandSqueezeReconcile
   *  to reconcile down, instead of silently never trying the marginal picks. */
  typeTargetLandCount?: number
): TargetCountsResult {
  const format = customization.deckFormat;

  // Calculate total deck cards — account for partner commanders taking an extra slot
  const commanderCount = hasPartner ? 2 : 1;
  const deckCards = format === 99 ? 100 - commanderCount : format - commanderCount;

  // Respect the user's land count — clamp only to sane absolute bounds
  const landCount = Math.min(
    Math.max(1, landCountOverride ?? customization.landCount),
    deckCards - 1
  );
  const nonLandBudgetLandCount = Math.min(
    Math.max(1, typeTargetLandCount ?? landCount),
    deckCards - 1
  );
  const nonLandCards = deckCards - nonLandBudgetLandCount;

  // If we have EDHREC stats, use percentage-based targets
  if (edhrecStats && edhrecStats.numDecks > 0) {
    const typeTargets = calculateTypeTargets(edhrecStats, nonLandCards);
    const curveTargets = calculateCurveTargets(
      edhrecStats.manaCurve,
      nonLandCards,
      customization.advancedTargets?.curvePercentages ? undefined : pacing
    );

    // Composition is now just for tracking - actual selection uses typeTargets
    const composition: DeckComposition = {
      lands: landCount,
      creatures: typeTargets.creature ?? 0,
      // These will be populated during card categorization
      singleRemoval: 0,
      boardWipes: 0,
      ramp: 0,
      cardDraw: 0,
      synergy: 0,
      utility: typeTargets.planeswalker ?? 0,
    };

    // Apply advanced target overrides if set
    applyAdvancedOverrides(customization, typeTargets, curveTargets, nonLandCards);

    return { composition, typeTargets, curveTargets };
  }

  // Fallback defaults for different formats (no usable EDHREC stats)
  logger.warn(
    '[DeckGen] FALLBACK: No EDHREC stats (numDecks=0 or missing) — using fallback type/curve targets'
  );
  const knownDefaults: Record<number, DeckComposition> = {
    99: {
      lands: landCount,
      ramp: 10,
      cardDraw: 10,
      singleRemoval: 8,
      boardWipes: 3,
      creatures: 25,
      synergy: 30,
      utility: 3,
    },
    60: {
      lands: landCount,
      ramp: 4,
      cardDraw: 4,
      singleRemoval: 5,
      boardWipes: 2,
      creatures: 15,
      synergy: 6,
      utility: 0,
    },
    40: {
      lands: landCount,
      ramp: 2,
      cardDraw: 2,
      singleRemoval: 3,
      boardWipes: 1,
      creatures: 11,
      synergy: 4,
      utility: 0,
    },
  };

  // Fallback type targets and curve targets — interpolate for custom sizes
  const fallbackComposition: DeckComposition =
    knownDefaults[format] ??
    (() => {
      // Scale proportionally based on non-land card count
      const ratio = nonLandCards / 62; // 62 = 99 - 37 lands (Commander baseline)
      return {
        lands: landCount,
        ramp: Math.max(1, Math.round(10 * ratio)),
        cardDraw: Math.max(1, Math.round(10 * ratio)),
        singleRemoval: Math.max(1, Math.round(8 * ratio)),
        boardWipes: Math.max(0, Math.round(3 * ratio)),
        creatures: Math.max(2, Math.round(25 * ratio)),
        synergy: Math.max(1, Math.round(30 * ratio)),
        utility: Math.max(0, Math.round(3 * ratio)),
      };
    })();
  // Fallback type targets — distribute nonLandCards across types using rough proportions
  // These MUST sum to nonLandCards; previous approach double-counted functional roles
  const rawTypeWeights = {
    creature: 0.4,
    instant: 0.15,
    sorcery: 0.12,
    artifact: 0.14,
    enchantment: 0.12,
    planeswalker: 0.04,
    battle: 0,
  };
  const fallbackTypeTargets: Record<string, number> = {};
  let fallbackAllocated = 0;
  for (const [type, weight] of Object.entries(rawTypeWeights)) {
    const target = Math.round(nonLandCards * weight);
    fallbackTypeTargets[type] = target;
    fallbackAllocated += target;
  }
  // Fix rounding — adjust creatures to hit exact total
  const fallbackDiff = nonLandCards - fallbackAllocated;
  if (fallbackDiff !== 0) {
    fallbackTypeTargets.creature = (fallbackTypeTargets.creature || 0) + fallbackDiff;
  }

  // Default balanced curve
  const fallbackCurveTargets: Record<number, number> = {
    0: Math.round(nonLandCards * 0.02),
    1: Math.round(nonLandCards * 0.12),
    2: Math.round(nonLandCards * 0.2),
    3: Math.round(nonLandCards * 0.25),
    4: Math.round(nonLandCards * 0.18),
    5: Math.round(nonLandCards * 0.12),
    6: Math.round(nonLandCards * 0.06),
    7: Math.round(nonLandCards * 0.05),
  };

  // Apply advanced target overrides if set
  applyAdvancedOverrides(customization, fallbackTypeTargets, fallbackCurveTargets, nonLandCards);

  return {
    composition: fallbackComposition,
    typeTargets: fallbackTypeTargets,
    curveTargets: fallbackCurveTargets,
  };
}
