// Empirical cube-design targets, derived from a corpus of popular public
// CubeCobra cubes (see frontend/scripts/mine-cube-targets.mjs). NO ratio here
// is hand-chosen — every number is the median (with p25/p75 range) of what real,
// well-regarded cubes actually do, per size band. Regenerate by re-running the
// miner; do not hand-edit cube-targets.json.

import raw from './cube-targets.json';

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

export interface BandTargets {
  size: number;
  n: number;
  color: Record<ColorBucket, Stat>;
  curve: Record<CurveSlot, Stat>;
  type: Record<string, Stat>;
  role: Record<Role, Stat>;
  /** Absolute count of nonbasic (fixing/utility) lands. */
  fixingLands: Stat;
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
  180: { players: 4, note: '180 cards — a tight 4-player pod drafts the whole cube' },
  270: { players: 6, note: '270 cards — a 6-player pod drafts the whole cube' },
  360: { players: 8, note: 'An 8-player draft sees the whole cube — every card matters' },
  450: { players: 8, note: 'An 8-player draft sees ~80% — room for more variety' },
  540: { players: 8, note: 'An 8-player draft sees ~67% — the classic MTGO Vintage Cube size' },
  720: { players: 8, note: 'An 8-player draft sees 50%, or run two pods at once' },
};

export const provenance = data.provenance;

export function targetsForSize(size: CubeSize): BandTargets {
  // Bands are mined for 360/450/540/720. Smaller pods (180/270) reuse the
  // closest mined band (360): the targets are size-relative ratios, so they
  // apportion correctly to the smaller size — we don't fabricate new ratios.
  return data.bands[String(size)] ?? data.bands['360'];
}
