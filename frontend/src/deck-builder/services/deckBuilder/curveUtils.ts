import { logger } from '@/lib/logger';
import type { EDHRECCommanderStats } from '@/deck-builder/types';
import type { Pacing } from '@/deck-builder/types';
import { Archetype } from '@/deck-builder/types';
import { PACING_CURVE_MULTIPLIERS } from './roleTargets';

/**
 * Calculate type distribution as percentages of non-land cards
 */
export function calculateTypePercentages(stats: EDHRECCommanderStats): Record<string, number> {
  const { typeDistribution, landDistribution } = stats;

  // Total non-land cards from EDHREC
  const totalNonLand =
    typeDistribution.creature +
    typeDistribution.instant +
    typeDistribution.sorcery +
    typeDistribution.artifact +
    typeDistribution.enchantment +
    typeDistribution.planeswalker +
    typeDistribution.battle;

  if (totalNonLand === 0) return {};

  return {
    creature: (typeDistribution.creature / totalNonLand) * 100,
    instant: (typeDistribution.instant / totalNonLand) * 100,
    sorcery: (typeDistribution.sorcery / totalNonLand) * 100,
    artifact: (typeDistribution.artifact / totalNonLand) * 100,
    enchantment: (typeDistribution.enchantment / totalNonLand) * 100,
    planeswalker: (typeDistribution.planeswalker / totalNonLand) * 100,
    battle: (typeDistribution.battle / totalNonLand) * 100,
    land: landDistribution.total, // Keep as absolute count for reference
    basicLand: landDistribution.basic,
    nonbasicLand: landDistribution.nonbasic,
  };
}

/**
 * Convert mana curve counts to percentages
 */
export function calculateCurvePercentages(
  manaCurve: Record<number, number>
): Record<number, number> {
  const total = Object.values(manaCurve).reduce((sum, count) => sum + count, 0);
  if (total === 0) return {};

  // Clamp to 7+ bucket (EDHREC groups everything 7+ together)
  const clamped: Record<number, number> = {};
  for (const [cmc, count] of Object.entries(manaCurve)) {
    const key = Math.min(parseInt(cmc), 7);
    clamped[key] = (clamped[key] || 0) + count;
  }

  const percentages: Record<number, number> = {};
  for (const [cmc, count] of Object.entries(clamped)) {
    percentages[parseInt(cmc)] = (count / total) * 100;
  }
  return percentages;
}

/**
 * Calculate target counts for each CMC bucket based on:
 * 1. EDHREC mana curve percentages
 * 2. Total non-land cards needed
 */
export function calculateCurveTargets(
  manaCurve: Record<number, number>,
  totalNonLandCards: number,
  pacing?: Pacing
): Record<number, number> {
  const percentages = calculateCurvePercentages(manaCurve);
  const targets: Record<number, number> = {};

  if (Object.keys(percentages).length === 0) {
    const fallback: Record<number, number> = {
      0: Math.round(totalNonLandCards * 0.02),
      1: Math.round(totalNonLandCards * 0.12),
      2: Math.round(totalNonLandCards * 0.2),
      3: Math.round(totalNonLandCards * 0.25),
      4: Math.round(totalNonLandCards * 0.18),
      5: Math.round(totalNonLandCards * 0.12),
      6: Math.round(totalNonLandCards * 0.06),
      7: Math.round(totalNonLandCards * 0.05),
    };
    if (pacing && pacing !== 'balanced') {
      const mult = PACING_CURVE_MULTIPLIERS[pacing];
      for (const cmc of Object.keys(fallback).map(Number)) {
        const phase = cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
        fallback[cmc] = Math.round(fallback[cmc] * mult[phase]);
      }
      const newTotal = Object.values(fallback).reduce((a, b) => a + b, 0);
      const normDiff = totalNonLandCards - newTotal;
      if (normDiff !== 0) {
        const largest = Object.keys(fallback)
          .map(Number)
          .reduce((max, cmc) => ((fallback[cmc] || 0) > (fallback[max] || 0) ? cmc : max), 3);
        fallback[largest] = (fallback[largest] || 0) + normDiff;
      }
    }
    return fallback;
  }

  let allocated = 0;
  const cmcKeys = Object.keys(percentages)
    .map(Number)
    .sort((a, b) => a - b);

  for (const cmc of cmcKeys) {
    const target = Math.round((percentages[cmc] / 100) * totalNonLandCards);
    targets[cmc] = target;
    allocated += target;
  }

  // Adjust for rounding errors - add/remove from largest bucket (usually CMC 3)
  const diff = totalNonLandCards - allocated;
  if (diff !== 0) {
    // Find the largest bucket to adjust
    const largestCmc = cmcKeys.reduce(
      (max, cmc) => ((targets[cmc] || 0) > (targets[max] || 0) ? cmc : max),
      cmcKeys[0]
    );
    targets[largestCmc] = (targets[largestCmc] || 0) + diff;
  }

  // Apply pacing multipliers to shift curve shape (skip if balanced or not specified)
  if (pacing && pacing !== 'balanced') {
    const mult = PACING_CURVE_MULTIPLIERS[pacing];
    for (const cmc of cmcKeys) {
      const phase = cmc <= 2 ? 'early' : cmc <= 4 ? 'mid' : 'late';
      targets[cmc] = Math.round(targets[cmc] * mult[phase]);
    }
    // Re-normalize to maintain exact total
    const newTotal = Object.values(targets).reduce((a, b) => a + b, 0);
    const normDiff = totalNonLandCards - newTotal;
    if (normDiff !== 0) {
      const largest = cmcKeys.reduce(
        (max, cmc) => ((targets[cmc] || 0) > (targets[max] || 0) ? cmc : max),
        cmcKeys[0]
      );
      targets[largest] = (targets[largest] || 0) + normDiff;
    }
  }

  return targets;
}

/**
 * Calculate target counts for each card type based on EDHREC percentages
 */
export function calculateTypeTargets(
  stats: EDHRECCommanderStats,
  totalNonLandCards: number
): Record<string, number> {
  const percentages = calculateTypePercentages(stats);

  logger.debug('[CurveUtils] EDHREC type distribution:', stats.typeDistribution);
  logger.debug('[CurveUtils] Calculated percentages:', percentages);
  logger.debug('[CurveUtils] Total non-land cards to allocate:', totalNonLandCards);

  if (Object.keys(percentages).length === 0) {
    logger.debug('[CurveUtils] Using fallback defaults (no EDHREC data)');
    // Fallback defaults
    return {
      creature: Math.round(totalNonLandCards * 0.45),
      instant: Math.round(totalNonLandCards * 0.12),
      sorcery: Math.round(totalNonLandCards * 0.12),
      artifact: Math.round(totalNonLandCards * 0.12),
      enchantment: Math.round(totalNonLandCards * 0.12),
      planeswalker: Math.round(totalNonLandCards * 0.03),
      battle: 0,
    };
  }

  const targets: Record<string, number> = {};
  let allocated = 0;
  const types = [
    'creature',
    'instant',
    'sorcery',
    'artifact',
    'enchantment',
    'planeswalker',
    'battle',
  ];

  for (const type of types) {
    const target = Math.round((percentages[type] / 100) * totalNonLandCards);
    targets[type] = target;
    allocated += target;
  }

  // Adjust for rounding errors - add/remove from creatures (largest category usually)
  const diff = totalNonLandCards - allocated;
  if (diff !== 0) {
    targets.creature = (targets.creature || 0) + diff;
  }

  logger.debug(
    '[CurveUtils] Final type targets:',
    targets,
    'Total:',
    Object.values(targets).reduce((a, b) => a + b, 0)
  );

  return targets;
}

// Archetype identity floors on top of `calculateTypeTargets`'s purely
// EDHREC-driven output: a spellslinger commander whose EDHREC page still
// skews creature-heavy (small sample size, or a build-around with few
// tracked decks) should still get a real spell-density floor, same idea for
// enchantress/artifacts. Expressed as a MINIMUM share of non-land slots
// across the listed types combined — a floor, not a fixed distribution, so
// it only ever pulls slots in, never removes them when EDHREC already clears
// the bar on its own.
const ARCHETYPE_TYPE_FLOORS: Partial<Record<Archetype, { types: string[]; minPercent: number }>> = {
  // Identity requires a critical mass of cheap spells to chain/copy/discount.
  [Archetype.SPELLSLINGER]: { types: ['instant', 'sorcery'], minPercent: 0.3 },
  [Archetype.STORM]: { types: ['instant', 'sorcery'], minPercent: 0.32 },
  // Enchantress/constellation draw engines key off enchantment COUNT.
  [Archetype.ENCHANTRESS]: { types: ['enchantment'], minPercent: 0.15 },
  // Affinity/artifact-synergy payoffs need enough artifacts to trigger off.
  [Archetype.ARTIFACTS]: { types: ['artifact'], minPercent: 0.15 },
  // Tribal payoffs (anthems/lords) need enough bodies to buff.
  [Archetype.TRIBAL]: { types: ['creature'], minPercent: 0.45 },
};

/**
 * Apply a bounded archetype identity floor to EDHREC-derived type targets, in
 * place. Never removes slots from a type that's already at/above the floor;
 * bounded to move at most 15% of non-land slots in one nudge so a thin
 * EDHREC sample can't blow out the curve/type balance the rest of the
 * pipeline expects. Donor is `creature` (usually the largest bucket) unless
 * creature IS one of the floored types, in which case `artifact` donates —
 * either way at least 2 cards are left in the donor bucket.
 */
export function applyArchetypeTypeFloor(
  typeTargets: Record<string, number>,
  archetype: Archetype,
  nonLandTotal: number
): void {
  const floor = ARCHETYPE_TYPE_FLOORS[archetype];
  if (!floor || nonLandTotal <= 0) return;

  const wantCount = Math.round(nonLandTotal * floor.minPercent);
  const haveCount = floor.types.reduce((s, t) => s + (typeTargets[t] ?? 0), 0);
  const deficit = wantCount - haveCount;
  if (deficit <= 0) return;

  const bounded = Math.min(deficit, Math.round(nonLandTotal * 0.15));
  const donor = floor.types.includes('creature') ? 'artifact' : 'creature';
  const available = typeTargets[donor] ?? 0;
  const taken = Math.min(bounded, Math.max(0, available - 2));
  if (taken <= 0) return;

  typeTargets[donor] = available - taken;
  let remainder = taken % floor.types.length;
  const perType = Math.floor(taken / floor.types.length);
  for (const t of floor.types) {
    typeTargets[t] = (typeTargets[t] ?? 0) + perType + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  logger.debug(
    `[CurveUtils] Archetype type floor (${archetype}): moved ${taken} slots from ${donor} to ${floor.types.join('/')}`
  );
}

/**
 * Check if a CMC bucket has room for more cards
 * Uses soft targeting with 10% overflow tolerance
 */
export function hasCurveRoom(
  cmc: number,
  curveTargets: Record<number, number>,
  currentCounts: Record<number, number>
): boolean {
  const normalizedCmc = Math.min(cmc, 7); // Cap at 7+
  const target = curveTargets[normalizedCmc] ?? 0;
  const current = currentCounts[normalizedCmc] ?? 0;

  // Allow 10% overflow, minimum 1 card tolerance
  const tolerance = Math.max(1, Math.ceil(target * 0.1));
  return current < target + tolerance;
}
