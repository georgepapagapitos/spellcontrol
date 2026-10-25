/**
 * Small pure helpers of the game loop, split out of `./engine.ts` to keep that
 * file under the size ratchet.
 */

import type { PoolUnit } from './cost';
import type { LandFace, LandSearch, ManaCost, ManaMask } from './types';

export const karstenBar = (mv: number): number => (89 + Math.min(7, Math.max(1, mv))) / 100;

export const unionOf = (units: readonly ManaMask[]): ManaMask => {
  let m = 0;
  for (const u of units) m |= u;
  return m;
};

/** Every mana type a land can supply: what it taps for, what it can choose, what it can fetch. */
export function reachOf(face: LandFace): ManaMask {
  let m = unionOf(face.units);
  if (face.choice) m |= face.choice.fixed | face.choice.options;
  if (face.fetch) m |= face.fetch.types;
  return m;
}

/** Marks a pool unit spent before the pool is compacted. */
export const SPENT: PoolUnit = { mask: 0, spend: 0, source: -1 };

/** Lexicographic "a beats b" over equal-length number tuples. */
export function beats(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** A land on the battlefield. */
export interface LandPerm {
  card: number;
  units: ManaMask[];
  /** First turn it can tap. */
  ready: number;
  /** Played as a land drop (a fetch's land counts); false = put in by a ramp spell. */
  fromDrop: boolean;
}

/** A rock, dork or other nonland mana permanent. */
export interface SourcePerm {
  units: ManaMask[];
  ready: number;
  oneShot: boolean;
  /** One-shot units not yet spent. */
  left: number;
}

/** A fetch in hand, for the re-chosen-drops supply. */
export interface HandFetch {
  mask: ManaMask;
  /** Could be today's drop with an untapped target. */
  now: boolean;
  /** Drawn this turn. */
  today: boolean;
  search: LandSearch;
}

export interface CostStat {
  cost: ManaCost;
  onTurn: number;
  on: number;
  onEnough: number;
  next: number;
  nextEnough: number;
  short: Float64Array;
}
