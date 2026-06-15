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
  twoCardComboCount: number;
  multiCardComboCount: number;
  fastManaCount: number;
  fastManaNames: string[];
  tutorCount: number;
  tutorNames: string[];
  staxPieceCount: number;
  staxPieceNames: string[];
  averageCmc: number;
  interactionCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

/** Human label for a bracket number (1–5). Falls back to the number itself. */
export function bracketLabel(bracket: number): string {
  return BRACKET_LABELS[bracket] ?? String(bracket);
}

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

/**
 * Canonical "stax piece" cards — resource-denial / lock / tax effects that
 * either slow opponents significantly or lock the game.
 *
 * Scryfall's only related oracle tag is `otag:stasis`, which covers ~12
 * tap-down effects (Winter Orb, Static Orb, Stasis, etc.) and misses the
 * larger spell-tax / cost-tax / strategy-hate body of stax cards. The
 * SpellControl tagger doesn't carry a stax tag either. So we maintain a
 * curated list here — the cEDH/competitive Commander community treats
 * these as the canonical pool. Several overlap with the Game Changers
 * list (Trinisphere, Drannith Magistrate) and are caught there too;
 * including them here as well is harmless since the floors stack.
 *
 * Floor thresholds parallel the combo logic:
 *  - 3+ pieces → bracket 3 floor (deliberate stax presence)
 *  - 5+ pieces → bracket 4 floor (stax-focused strategy)
 */
const STAX_PIECES = new Set([
  // Tap-down / mana denial (otag:stasis subset)
  'Winter Orb',
  'Static Orb',
  'Stasis',
  'Rising Waters',
  'Damping Field',
  'Smoke',
  'Imi Statue',
  // Resource taxes
  'Sphere of Resistance',
  'Thorn of Amethyst',
  'Lodestone Golem',
  'Damping Sphere',
  'Thalia, Guardian of Thraben',
  'Esper Sentinel',
  'Archon of Emeria',
  'Eidolon of Rhetoric',
  'Spirit of the Labyrinth',
  'Vryn Wingmare',
  'Glowrider',
  'Rule of Law',
  // Cumulative-upkeep / artifact stax
  'Smokestack',
  'Tangle Wire',
  // Activated-ability / artifact hate
  'Cursed Totem',
  'Null Rod',
  'Stony Silence',
  'Collector Ouphe',
  'Linvala, Keeper of Silence',
  // Search / commander-strategy hate
  'Aven Mindcensor',
  'Notion Thief',
]);

const STAX_FLOOR_BRACKET_3_THRESHOLD = 3;
const STAX_FLOOR_BRACKET_4_THRESHOLD = 5;

/**
 * The estimator's default/minimum auto-assigned bracket: Core (2), not Exhibition (1).
 * See the rationale at the `floor` computation in `estimateBracket`. Bracket 1 is a
 * theme-build intent, never inferred from card power, so the estimator floors here.
 */
const CORE_BASELINE = 2;

/**
 * True when `name` is a canonical stax / lock piece (the same curated pool the
 * estimator counts for its stax floors). Exposed so the Bracket Fit replacement
 * finder can refuse to swap in another stax piece — which would re-trigger the
 * very floor the cut was meant to lower.
 */
export function isStaxPiece(name: string): boolean {
  return STAX_PIECES.has(name);
}

/**
 * Tutor handling — known divergence from current strict-RC text.
 *
 * The October 2025 RC update **removed tutor restrictions entirely** from
 * brackets 1-3 (relying on the Game Changers list to catch the most
 * powerful tutors: Demonic, Vampiric, Imperial Seal, Mystical, etc.):
 *   - https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025
 *
 * However, ScrollVault (the most-validated community bracket calculator,
 * claiming 97.2% exact-bracket accuracy) still uses tutor count as a soft
 * signal:
 *   - https://scrollvault.net/tools/commander-bracket/
 *
 * We follow ScrollVault here — tutors contribute to the soft score but
 * don't trigger any hard floor. The strict-RC interpretation can be
 * obtained by passing roleCounts that don't have a tutor signal, since
 * this only affects soft scoring, not floors.
 */

// ── Estimation ─────────────────────────────────────────────────────────────

/**
 * Deck-relative assembly speed score, mirroring ScrollVault's acceleration model.
 * B4 threshold is score >= 4.
 * - fastMana.length >= 5: +3; 3–4: +2; <3: +0
 * - tutors.length  >= 6: +2; 4–5: +1; <4: +0
 */
function accelerationScore(fastMana: string[], tutors: string[]): number {
  const fastScore = fastMana.length >= 5 ? 3 : fastMana.length >= 3 ? 2 : 0;
  const tutorScore = tutors.length >= 6 ? 2 : tutors.length >= 4 ? 1 : 0;
  return fastScore + tutorScore;
}

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
  const staxPieces: string[] = [];

  for (const name of allCardNames) {
    if (gameChangerNames.has(name)) gameChangers.push(name);
    if (isMassLandDenial(name)) massLandDenial.push(name);
    if (isExtraTurn(name)) extraTurns.push(name);
    if (FAST_MANA.has(name)) fastMana.push(name);
    if (STAX_PIECES.has(name)) staxPieces.push(name);
    // Only count as tutor if primary role is cardDraw — cards like Cultivate
    // have the tutor tag but their primary role is ramp, not tutoring.
    if (hasTag(name, 'tutor') && getCardRole(name) === 'cardDraw') tutors.push(name);
  }

  // ── 2. Classify combos ──

  let twoCardComboCount = 0;
  let multiCardComboCount = 0;

  if (detectedCombos) {
    for (const combo of detectedCombos) {
      if (!combo.isComplete) continue;
      const is2Card = combo.cardCount <= 2;
      if (is2Card) {
        twoCardComboCount++;
      } else {
        multiCardComboCount++;
      }
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

  if (twoCardComboCount > 0) {
    // Deck-relative speed: can the deck assemble a 2-card combo before ~turn 6?
    // R/S bracketTag = Spellbook's signal that the combo is near-guaranteed early.
    // High acceleration (fastMana + tutors) escalates the same combo to B4.
    const accel = accelerationScore(fastMana, tutors);
    const hasReliableTag = detectedCombos?.some(
      (c) => c.isComplete && c.cardCount <= 2 && (c.bracketTag === 'R' || c.bracketTag === 'S')
    );
    const isEarlyAssembly = accel >= 4 || hasReliableTag;

    if (isEarlyAssembly) {
      hardFloors.push({
        bracket: 4,
        reason: `${twoCardComboCount} fast two-card combo${twoCardComboCount === 1 ? '' : 's'}`,
        detail:
          'This combo can fire before opponents can respond — equivalent to competitive power.',
      });
    } else {
      hardFloors.push({
        bracket: 3,
        reason: `${twoCardComboCount} two-card combo${twoCardComboCount === 1 ? '' : 's'}`,
        detail:
          'An infinite combo with two cards bumps the power level — even if the deck isn’t optimized to assemble it quickly.',
      });
    }
  }
  // 3+-card combos: soft score only (no hard floor). They already contributed to
  // fastMana/tutor counts which drive the soft score.

  if (extraTurns.length >= EXTRA_TURN_FLOOR_THRESHOLD) {
    // Per RC: 1–2 extra-turn spells is fine in any bracket. Floor only triggers
    // at 3+ as that strongly implies an extra-turn strategy (chaining),
    // which is Bracket 4 behavior per the RC rules.
    hardFloors.push({
      bracket: 4,
      reason: `${extraTurns.length} extra turn spells (chain-likely)`,
      detail:
        'Three or more extra-turn spells signals a deck built to chain them — Bracket 4 behavior per the RC rules.',
    });
  }

  if (staxPieces.length >= STAX_FLOOR_BRACKET_4_THRESHOLD) {
    hardFloors.push({
      bracket: 4,
      reason: `${staxPieces.length} stax / lock pieces`,
      detail:
        'Heavy stax presence locks opponents out of the game — functionally similar to mass land denial.',
    });
  } else if (staxPieces.length >= STAX_FLOOR_BRACKET_3_THRESHOLD) {
    hardFloors.push({
      bracket: 3,
      reason: `${staxPieces.length} stax / lock pieces`,
      detail:
        'Multiple stax pieces signal a deliberate resource-denial plan — generally accepted but pushes power up.',
    });
  }

  // Default floor is Core (2), NOT Exhibition (1). Per the official RC Commander
  // Brackets system, Bracket 2 "Core" is the baseline for the vast majority of
  // homebrewed/precon-level decks ("the average current preconstructed deck is at
  // a Core level"), while Bracket 1 "Exhibition" is a deliberate theme-over-winning
  // build that card content alone cannot detect. So a deck with no power signals is
  // Core, not Exhibition — the estimator never auto-assigns Bracket 1. (Exhibition
  // is reachable only as a user-declared intent, e.g. a manual bracket override.)
  //   - https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026
  //   - https://edhrec.com/articles/adapting-your-decks-to-core-bracket-2
  const floor =
    hardFloors.length > 0 ? Math.max(...hardFloors.map((f) => f.bracket)) : CORE_BASELINE;

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
      twoCardComboCount,
      multiCardComboCount,
      fastManaCount: fastMana.length,
      fastManaNames: fastMana,
      tutorCount: tutors.length,
      tutorNames: tutors,
      staxPieceCount: staxPieces.length,
      staxPieceNames: staxPieces,
      averageCmc,
      interactionCount,
    },
  };
}
