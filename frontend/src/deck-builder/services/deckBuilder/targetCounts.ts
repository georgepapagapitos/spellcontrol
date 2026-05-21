// Target-count computation: turns a Customization (+ optional EDHREC stats) into
// per-type and per-CMC slot targets, applying any advanced user overrides.
// Pure — extracted verbatim from deckGenerator.ts for isolation/testing.
import { logger } from '@/lib/logger';
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
  pacing?: Pacing
): TargetCountsResult {
  const format = customization.deckFormat;

  // Calculate total deck cards — account for partner commanders taking an extra slot
  const commanderCount = hasPartner ? 2 : 1;
  const deckCards = format === 99 ? 100 - commanderCount : format - commanderCount;

  // Respect the user's land count — clamp only to sane absolute bounds
  const landCount = Math.min(Math.max(1, customization.landCount), deckCards - 1);
  const nonLandCards = deckCards - landCount;

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
