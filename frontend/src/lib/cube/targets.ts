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

/** The cube sizes we offer — players × 3 × 15, all multiples of 45. */
export const CUBE_SIZES = [360, 450, 540, 720] as const;
export type CubeSize = (typeof CUBE_SIZES)[number];

/** Player count a size drafts (size / 45) and how much of the cube gets seen in one pod. */
export const SIZE_INFO: Record<CubeSize, { players: number; note: string }> = {
  360: { players: 8, note: '8 players draft the whole cube — tight, every card matters' },
  450: { players: 8, note: '~80% seen per draft — room for more variety' },
  540: { players: 8, note: '~67% seen per draft — the classic MTGO Vintage Cube size' },
  720: { players: 8, note: '50% seen per draft, or two 8-player pods at once' },
};

export const provenance = data.provenance;

export function targetsForSize(size: CubeSize): BandTargets {
  return data.bands[String(size)];
}
