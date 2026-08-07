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
  synergyProducers?: AxisKey[]; // archetype axes this card enables (see synergy-tags)
  synergyPayoffs?: AxisKey[]; // archetype axes this card pays off
}

export const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

export const isLand = (c: CubeCard) => /\bland\b/i.test(c.typeLine);

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
