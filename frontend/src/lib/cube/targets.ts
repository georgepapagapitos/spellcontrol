// Empirical cube-design targets, derived from a corpus of popular public
// CubeCobra cubes (see frontend/scripts/mine-cube-targets.mjs). NO ratio here
// is hand-chosen — every number is the median (with p25/p75 range) of what real,
// well-regarded cubes actually do, per size band. Regenerate by re-running the
// miner; do not hand-edit cube-targets.json.

import raw from './cube-targets.json';
import type { CubeFormat } from './play-format';
import type { ColorPair } from './core';

/**
 * Which corpus a cube's colour/curve/type/fixing shape is measured against —
 * `'any'` reads the size band (the default); `'pauper'`/`'peasant'` read the
 * corpus mined from real pauper/peasant cubes instead (board E464 — a pauper
 * pool has far fewer good nonbasic lands to draw from than a powered cube, so
 * real pauper/peasant cubes run a leaner manabase and less colorless than the
 * all-cube size band assumes). Same three values as `./pool-filters`'s
 * `RarityCap`, kept as its own type so this leaf module needs no import for a
 * 3-value string union.
 */
export type BandRarity = 'any' | 'pauper' | 'peasant';

/** A card's color bucket — the primary axis a cube is balanced on. */
export type ColorBucket = 'W' | 'U' | 'B' | 'R' | 'G' | 'multicolor' | 'colorless' | 'land';
/** Functional role, classified by the shared tagger (mirrors tagger `RoleKey`). */
export type Role = 'removal' | 'boardwipe' | 'ramp' | 'cardDraw';
/** CMC buckets, 7 = "7 or more". */
export type CurveSlot = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7';

/** Median + interquartile range for one measured share/count across the corpus. */
export interface Stat {
  median: number;
  p25: number;
  p75: number;
}

/** Per-pair corpus shape (see frontend/scripts/mine-cube-targets.mjs). */
export interface PairTargets {
  /** Share of TOTAL cube cards that are exactly-two-color gold cards of this pair. */
  gold: Stat;
  /** Absolute count of lands whose produced mana covers this pair (a land can
   *  count toward more than one pair — see `pairsFixedBy` in ./core). */
  fixingLands: Stat;
}

export interface BandTargets {
  size: number;
  n: number;
  color: Record<ColorBucket, Stat>;
  curve: Record<CurveSlot, Stat>;
  type: Record<string, Stat>;
  role: Record<Role, Stat>;
  /** Absolute count of nonbasic (fixing/utility) lands. */
  fixingLands: Stat;
  /** The ten color pairs' own gold + fixing-land shape. */
  pairs: Record<ColorPair, PairTargets>;
}

interface TargetsFile {
  provenance: {
    generatedAt: string;
    source: string;
    method: string;
    taggerGeneratedAt: string;
    bands: Record<string, { n: number; cubes: { id: string; name: string; likes: number }[] }>;
  };
  bands: Record<string, BandTargets>;
}

const data = raw as unknown as TargetsFile;

// Cube sizes we offer — each is players × 3 packs × 15 cards (45 per drafter).
// A draft pod is conventionally 8 players (8 × 45 = 360), so 360–720 are all
// 8-player cubes that differ by how much of the cube one pod sees; the smaller
// 180/270 sizes are for 4- and 6-player playgroups.
export const CUBE_SIZES = [180, 270, 360, 450, 540, 720] as const;
export type CubeSize = (typeof CUBE_SIZES)[number];

/** Pod size a cube is built for, plus a one-line note explaining the trade-off. */
export const SIZE_INFO: Record<CubeSize, { players: number; note: string }> = {
  180: { players: 4, note: '180 cards. A tight 4-player pod drafts the whole cube' },
  270: { players: 6, note: '270 cards. A 6-player pod drafts the whole cube' },
  360: { players: 8, note: 'An 8-player draft sees the whole cube. Every card matters' },
  450: { players: 8, note: 'An 8-player draft sees ~80% of the cube. Room for more variety' },
  540: {
    players: 8,
    note: 'An 8-player draft sees ~67% of the cube, the classic MTGO Vintage Cube size',
  },
  720: { players: 8, note: 'An 8-player draft sees 50%, or run two pods at once' },
};

/**
 * `SIZE_INFO` for any size, including one we don't offer. A saved cube's size
 * is persisted and synced, so it can be a value this build has never heard of
 * (a cube saved by an older/newer app version, or a hand-written sync row).
 * Indexing `SIZE_INFO` blind on one of those was an undefined deref that took
 * the ENTIRE cube workshop down through the ErrorBoundary — with no escape,
 * because deleting the cube lives only on the page that crashed (board E353).
 * Every read of the table goes through here; never index it directly.
 */
export function sizeInfo(size: number): { players: number; note: string } {
  const known = SIZE_INFO[size as CubeSize];
  if (known) return known;
  // 45 cards per drafter (3 packs of 15) — the same arithmetic the six known
  // sizes are built from, so an unfamiliar size still reads as a real cube.
  const players = Math.max(1, Math.round(size / 45));
  return { players, note: `${size} cards` };
}

export const provenance = data.provenance;

/**
 * The corpus band a cube is shaped toward. `limited` reads the size band (or
 * the closest mined one); `commander` reads the band mined from popular
 * CubeCobra Commander cubes, whose ratios are size-free — only `fixingLands`
 * (an absolute count) is rescaled from that band's median mainboard.
 *
 * `rarity` narrows a `limited` cube further: `'pauper'`/`'peasant'` swap the
 * colour/curve/type/fixing shape for the mined pauper/peasant corpus band
 * (also size-free, scaled the same way as commander), while `role` STAYS on
 * the size band — measured 2026-09-27 (board E464): removal/ramp/wipe/draw
 * shares in real pauper/peasant cubes already match the all-cube size band
 * within noise, only colour/curve/type/fixing were off, so role doesn't need
 * its own band. Has no effect on a `commander` cube (format wins).
 */
export function targetsForSize(
  size: CubeSize,
  format: CubeFormat = 'limited',
  rarity: BandRarity = 'any'
): BandTargets {
  if (format === 'commander') return scaled(data.bands.commander, size);
  const exact = data.bands[String(size)];
  // Bands are mined for 360/450/540/720. Smaller pods (180/270) reuse the
  // closest mined band (360). Color/curve/role/type are size-free RATIOS, so they
  // apportion correctly to the smaller size as-is. `fixingLands` is the one
  // ABSOLUTE count, so it must scale with the cube — otherwise a 180-card cube is
  // judged against 360-card fixing counts (29 lands flagged "short of 39–70" even
  // though that's a healthy ~16% land density at either size).
  const sizeBand = exact ?? scaled(data.bands['360'], size);
  if (rarity === 'any') return sizeBand;
  const corpus = data.bands[rarity];
  if (!corpus) return sizeBand;
  return { ...scaled(corpus, size), role: sizeBand.role };
}

const scaleStat = (s: Stat, k: number): Stat => ({
  median: s.median * k,
  p25: s.p25 * k,
  p75: s.p75 * k,
});

function scaled(base: BandTargets, size: CubeSize): BandTargets {
  const k = size / base.size;
  const pairs = {} as Record<ColorPair, PairTargets>;
  for (const [pair, t] of Object.entries(base.pairs) as [ColorPair, PairTargets][]) {
    // `gold` is a size-free RATIO (same basis as color.multicolor) — carried
    // over as-is; `fixingLands` is an absolute count, so it scales like the
    // top-level one.
    pairs[pair] = { gold: t.gold, fixingLands: scaleStat(t.fixingLands, k) };
  }
  return {
    ...base,
    size,
    fixingLands: scaleStat(base.fixingLands, k),
    pairs,
  };
}
