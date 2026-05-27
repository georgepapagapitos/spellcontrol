import type { DetectedCombo } from '@/deck-builder/types';
import {
  hasTag,
  isMassLandDenial,
  isExtraTurn,
  getCardRole,
} from '@/deck-builder/services/tagger/client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface BracketEstimation {
  bracket: 1 | 2 | 3 | 4 | 5;
  label: string;
  hardFloors: BracketFloor[];
  softScore: number;
  breakdown: BracketBreakdown;
}

export interface BracketFloor {
  bracket: number;
  reason: string;
  detail?: string;
}

export interface BracketBreakdown {
  gameChangerCount: number;
  gameChangerNames: string[];
  massLandDenialCount: number;
  massLandDenialNames: string[];
  extraTurnCount: number;
  extraTurnNames: string[];
  earlyComboCount: number;
  lateComboCount: number;
  fastManaCount: number;
  fastManaNames: string[];
  tutorCount: number;
  tutorNames: string[];
  averageCmc: number;
  interactionCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

/**
 * Fast mana sources used as a power-density soft signal.
 *
 * Excludes Sol Ring: the RC and the wider community treat it as a
 * precon-staple exempt from "fast mana" — it appears in every precon
 * and is explicitly allowed in brackets 1–2. Including it here would
 * penalize every casual deck unfairly.
 *   - https://tcgprotectors.com/blogs/mtg-deck-building-guides/mtg-commander-bracket-system-2026-explained
 */
const FAST_MANA = new Set([
  'Mana Crypt',
  'Mana Vault',
  'Grim Monolith',
  'Chrome Mox',
  'Mox Diamond',
  "Lion's Eye Diamond",
  'Lotus Petal',
  'Mox Opal',
  'Mox Amber',
  'Dark Ritual',
  'Cabal Ritual',
  'Simian Spirit Guide',
  'Elvish Spirit Guide',
  'Rite of Flame',
  'Ancient Tomb',
  'Jeweled Lotus',
]);

/**
 * Bracket-2 floor for extra turns kicks in only at 3+. Per RC guidance,
 * one or two extra-turn spells in a deck is fine across any bracket —
 * what bracket 2 actually restricts is *chaining* (building around
 * repeatedly playing extra turns). A deck with 3+ extra-turn spells
 * strongly implies an extra-turn strategy.
 *   - https://edhrec.com/articles/what-does-it-look-like-to-chain-extra-turns-in-commander
 */
const EXTRA_TURN_FLOOR_THRESHOLD = 3;

/**
 * Interaction-percentage thresholds (proportion of non-land cards that are
 * removal or boardwipes). Derived from ScrollVault's bracket calculator,
 * which buckets bracket 1–2 decks at 8–15% interaction density and
 * bracket 4–5 decks at 15–28%.
 *   - https://scrollvault.net/tools/commander-bracket/
 *
 * Linearly map [0.10, 0.22] to [0, INTERACTION_CAP] points.
 */
const INTERACTION_PCT_MIN = 0.1;
const INTERACTION_PCT_MAX = 0.22;
const INTERACTION_CAP = 15;
/** Approximate non-land count for a 100-card Commander deck (37 lands). */
const COMMANDER_NONLAND_COUNT = 63;

// ── Estimation ─────────────────────────────────────────────────────────────

export function estimateBracket(
  allCardNames: string[],
  detectedCombos: DetectedCombo[] | undefined,
  averageCmc: number,
  _deckScore: number | undefined,
  roleCounts: Record<string, number> | undefined,
  gameChangerNames: Set<string>
): BracketEstimation {
  // ── 1. Count signals ──

  const gameChangers: string[] = [];
  const massLandDenial: string[] = [];
  const extraTurns: string[] = [];
  const fastMana: string[] = [];
  const tutors: string[] = [];

  for (const name of allCardNames) {
    if (gameChangerNames.has(name)) gameChangers.push(name);
    if (isMassLandDenial(name)) massLandDenial.push(name);
    if (isExtraTurn(name)) extraTurns.push(name);
    if (FAST_MANA.has(name)) fastMana.push(name);
    // Only count as tutor if primary role is cardDraw — cards like Cultivate
    // have the tutor tag but their primary role is ramp, not tutoring.
    if (hasTag(name, 'tutor') && getCardRole(name) === 'cardDraw') tutors.push(name);
  }

  // ── 2. Classify combos ──

  let earlyComboCount = 0;
  let lateComboCount = 0;

  if (detectedCombos) {
    for (const combo of detectedCombos) {
      if (!combo.isComplete) continue;
      const bracketNum = parseInt(combo.bracket, 10);
      if (isNaN(bracketNum)) continue;
      if (bracketNum >= 4) earlyComboCount++;
      else if (bracketNum === 3) lateComboCount++;
    }
  }

  // ── 3. Interaction count (removal + counterspell + boardwipe) ──

  const interactionCount = roleCounts
    ? (roleCounts['removal'] ?? 0) + (roleCounts['boardwipe'] ?? 0)
    : 0;

  // ── 4. Hard floor rules ──

  const hardFloors: BracketFloor[] = [];

  if (gameChangers.length >= 4) {
    hardFloors.push({
      bracket: 4,
      reason: `${gameChangers.length} Game Changer cards`,
      detail:
        'Cards that warp the game on resolution — having 4+ pushes into high-power territory.',
    });
  } else if (gameChangers.length > 0) {
    hardFloors.push({
      bracket: 3,
      reason: `${gameChangers.length} Game Changer card${gameChangers.length > 1 ? 's' : ''}`,
      detail:
        gameChangers.length > 1
          ? 'These cards can take over a game on their own. Most casual tables expect to see a few.'
          : 'This card can take over a game on its own. Most casual tables expect to see a few.',
    });
  }

  if (massLandDenial.length > 0) {
    hardFloors.push({
      bracket: 4,
      reason: `Mass land denial (${massLandDenial.join(', ')})`,
      detail:
        'Destroying or locking all lands prevents opponents from playing the game — one of the strongest effects in Commander.',
    });
  }

  if (earlyComboCount >= 2) {
    hardFloors.push({
      bracket: 4,
      reason: `${earlyComboCount} early-game infinite combos`,
      detail:
        'Multiple ways to win out of nowhere before opponents can set up. This is competitive-level power.',
    });
  } else if (earlyComboCount === 1) {
    hardFloors.push({
      bracket: 3,
      reason: '1 early-game infinite combo',
      detail:
        'An infinite combo that can fire early means games can end before everyone gets to play.',
    });
  }

  if (lateComboCount > 0) {
    hardFloors.push({
      bracket: 3,
      reason: `${lateComboCount} late-game combo${lateComboCount > 1 ? 's' : ''}`,
      detail:
        'Infinite combos that need setup are generally accepted, but they still bump the power level.',
    });
  }

  if (extraTurns.length >= EXTRA_TURN_FLOOR_THRESHOLD) {
    // Per RC: 1–2 extra-turn spells is fine in any bracket. Floor only triggers
    // at 3+ as that strongly implies an extra-turn strategy (chaining), which
    // is what bracket 2 actually restricts.
    hardFloors.push({
      bracket: 2,
      reason: `${extraTurns.length} extra turn spells (chain-likely)`,
      detail:
        'Three or more extra-turn spells suggests the deck is built to chain them — the bracket-2 restriction.',
    });
  }

  const floor = hardFloors.length > 0 ? Math.max(...hardFloors.map((f) => f.bracket)) : 1;

  // ── 5. Soft score (0-100) ──

  // Interaction density as a proportion of non-land cards (per ScrollVault):
  // bracket 1–2 sits at 8–15%, bracket 4–5 at 15–28%. Linearly map
  // [INTERACTION_PCT_MIN, INTERACTION_PCT_MAX] to [0, INTERACTION_CAP] points.
  // Falls back to the Commander-default non-land count when the deck size
  // hint is missing, since brackets are a Commander concept.
  const nonLandCount = Math.max(1, allCardNames.length - 37) || COMMANDER_NONLAND_COUNT;
  const interactionPct = interactionCount / nonLandCount;
  const interactionBonus = Math.min(
    INTERACTION_CAP,
    Math.max(
      0,
      ((interactionPct - INTERACTION_PCT_MIN) / (INTERACTION_PCT_MAX - INTERACTION_PCT_MIN)) *
        INTERACTION_CAP
    )
  );

  const softScore = Math.min(
    100,
    Math.min(40, fastMana.length * 8) +
      Math.min(25, tutors.length * 5) +
      Math.min(20, Math.max(0, (3.5 - averageCmc) * 15)) +
      interactionBonus
  );

  // ── 6. Final bracket ──

  let bracket: number = floor;

  if (floor >= 4 && softScore >= 80) {
    bracket = 5;
  } else if (floor < 4 && softScore >= 66) {
    bracket = Math.min(floor + 1, 4);
  }

  const clampedBracket = Math.max(1, Math.min(5, bracket)) as 1 | 2 | 3 | 4 | 5;

  return {
    bracket: clampedBracket,
    label: BRACKET_LABELS[clampedBracket],
    hardFloors,
    softScore: Math.round(softScore),
    breakdown: {
      gameChangerCount: gameChangers.length,
      gameChangerNames: gameChangers,
      massLandDenialCount: massLandDenial.length,
      massLandDenialNames: massLandDenial,
      extraTurnCount: extraTurns.length,
      extraTurnNames: extraTurns,
      earlyComboCount,
      lateComboCount,
      fastManaCount: fastMana.length,
      fastManaNames: fastMana,
      tutorCount: tutors.length,
      tutorNames: tutors,
      averageCmc,
      interactionCount,
    },
  };
}
