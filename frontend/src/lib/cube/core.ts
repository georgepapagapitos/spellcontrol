// Shared leaves for the cube pipeline — the card shape plus the handful of
// pure classifiers that `generate`, `objective` and `refine` all need.
//
// This module exists to break a value-level import cycle: `objective` and
// `refine` needed `bucketOf`/`curveSlotOf`/`isLand`/`COLORS` from `generate`,
// while `generate` needs `AXIS_LABEL` from `objective` and `refineCube` from
// `refine`. Per the established rule (see the repo cleanup wave), the fix for a
// cycle is to push the shared leaf DOWN into its own module — never to import
// back up into the parent. Nothing here may import from `./generate`,
// `./objective` or `./refine`.

import type { ColorBucket, CurveSlot, Role } from './targets';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

export interface CubeCard {
  name: string;
  oracleId: string;
  colors: string[]; // [] = colorless
  cmc: number;
  typeLine: string;
  role: Role | null; // precomputed via the shared tagger
  rank?: number; // edhrecRank — lower is more-played; undefined = unknown
  /** CubeCobra cube popularity, % of cubes holding the card (see ./signal). undefined = never cubed / unknown. */
  cubePop?: number;
  /** CubeCobra draft Elo (see ./signal). */
  cubeElo?: number;
  synergyProducers?: AxisKey[]; // archetype axes this card enables (see synergy-tags)
  synergyPayoffs?: AxisKey[]; // archetype axes this card pays off
  /**
   * Commander-rules colour identity. Optional — absent on pools built before
   * this shipped, or when the source facts don't carry it. `pairOf`/
   * `pairsFixedBy` fall back to `colors` when it's missing, so an old saved
   * cube or a pool without it still classifies (just less precisely for a
   * card whose identity differs from its cast colors, e.g. a hybrid or a
   * color-indicator card).
   */
  colorIdentity?: string[];
  /**
   * Mana a LAND can produce (Scryfall's `produced_mana`). Optional, lands
   * only — a fixing land's color_identity usually matches what it produces
   * (its ability text carries the same colored symbols), but "add one mana of
   * any color" lands (Command Tower, Arcane Signet) have no colored symbol in
   * their oracle text and so an EMPTY color identity despite fixing every
   * pair; produced_mana is what `pairsFixedBy` needs to get those right.
   * Falls back to colorIdentity, then colors, when absent.
   */
  producedMana?: string[];
  /**
   * Full Oracle rules text. Optional — most of the pipeline never needs it
   * (type_line + color_identity cover bucket/pair classification), so it's
   * left off the pool's fast path; ./legend's `isLegendCandidate` is the one
   * consumer that reads it (the "can be your commander" pattern backgrounds
   * and a few planeswalkers use has no type_line or keyword to key off).
   */
  oracleText?: string;
}

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

export const isLand = (c: CubeCard) => /\bland\b/i.test(c.typeLine);

/** The card's color identity for pair classification, falling back through
 *  colorIdentity → colors, filtered to WUBRG (strips generic/colorless).
 *  Exported for ./legend, which classifies a legend's identity the same way
 *  pairOf classifies a gold card's — mono/pair/3+ all read off this. */
export function identityColors(c: CubeCard): string[] {
  return (c.colorIdentity ?? c.colors).filter((x) => COLORS.includes(x as (typeof COLORS)[number]));
}

/**
 * The ten two-color pairs, in "color wheel" order: the five allied (adjacent)
 * pairs first, then the five enemy (opposite) pairs. Order is used only for
 * deterministic tiebreaking (apportionment, land-fill priority) — it carries
 * no ranking meaning.
 */
export const COLOR_PAIRS = ['WU', 'UB', 'BR', 'RG', 'GW', 'WB', 'UR', 'BG', 'RW', 'GU'] as const;
export type ColorPair = (typeof COLOR_PAIRS)[number];

const PAIR_BY_KEY = new Map<string, ColorPair>(COLOR_PAIRS.map((p) => [[...p].sort().join(''), p]));

/** A card's exactly-two-color identity as a canonical `ColorPair`, or null for
 *  a mono/colorless card or a 3+ color card (neither is a pair). */
export function pairOf(c: CubeCard): ColorPair | null {
  const colors = [...new Set(identityColors(c))];
  if (colors.length !== 2) return null;
  return PAIR_BY_KEY.get(colors.sort().join('')) ?? null;
}

/** Every pair a LAND fixes: every 2-color subset of what it can produce (a
 *  triland fixes 3 pairs, a five-color land fixes all 10). Falls back through
 *  producedMana → colorIdentity → colors — see `CubeCard.producedMana`'s doc
 *  for why produced mana, not identity, is the right basis for a land. */
export function pairsFixedBy(c: CubeCard): ColorPair[] {
  const produced = [
    ...new Set(
      (c.producedMana ?? c.colorIdentity ?? c.colors).filter((x) =>
        COLORS.includes(x as (typeof COLORS)[number])
      )
    ),
  ];
  if (produced.length < 2) return [];
  const out: ColorPair[] = [];
  for (let i = 0; i < produced.length; i++) {
    for (let j = i + 1; j < produced.length; j++) {
      const p = PAIR_BY_KEY.get([produced[i], produced[j]].sort().join(''));
      if (p) out.push(p);
    }
  }
  return out;
}

export function bucketOf(c: CubeCard): ColorBucket {
  if (isLand(c)) return 'land';
  const colors = c.colors.filter((x) => COLORS.includes(x as (typeof COLORS)[number]));
  if (colors.length === 0) return 'colorless';
  if (colors.length > 1) return 'multicolor';
  return colors[0] as ColorBucket;
}

export function curveSlotOf(cmc: number): CurveSlot {
  return String(Math.min(7, Math.max(0, Math.round(cmc || 0)))) as CurveSlot;
}

/** quality: the cube-native signal first — higher CubeCobra popularity (share
 *  of cubes holding the card), then higher draft Elo — and EDHREC rank only for
 *  cards CubeCobra has never seen, which sort after every cubed card (lower rank
 *  = better; unknown last). EDHREC rank alone is Commander popularity: it put
 *  Command Tower and Arcane Signet at the top of a draft cube's colorless
 *  section (E288). oracleId breaks ties so every sort (and thus the whole cube,
 *  or legend section — see ./legend) is deterministic regardless of the pool's
 *  incoming order. Lives here (not ./generate) so ./legend can rank candidates
 *  without importing back up into ./generate — the same cycle-avoidance rule
 *  every other shared classifier in this file follows. Re-exported from
 *  ./generate unchanged, so every existing `from './cube/generate'` import
 *  site keeps working. */
export const byQuality = (a: CubeCard, b: CubeCard) =>
  (b.cubePop ?? -1) - (a.cubePop ?? -1) ||
  (b.cubeElo ?? -1) - (a.cubeElo ?? -1) ||
  (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
  a.oracleId.localeCompare(b.oracleId);
