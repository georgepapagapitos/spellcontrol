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

/** `order` with one copy of each id in `ids` taken out, the rest in their order. */
export function withoutOne(order: readonly number[], ids: readonly number[]): number[] {
  const rest = order.slice();
  for (const id of ids) {
    const at = rest.indexOf(id);
    if (at >= 0) rest.splice(at, 1);
  }
  return rest;
}

/** A fresh counter for one cost measured on one turn. */
export function newCostStat(cost: ManaCost, onTurn: number): CostStat {
  return {
    cost,
    onTurn,
    on: 0,
    onEnough: 0,
    next: 0,
    nextEnough: 0,
    short: new Float64Array(6),
  };
}

/** Mana spent over mana available, per turn and per game (Ertai's "mana curve" of a deck). */
export interface Utilization {
  /** Games measured. */
  games: number;
  /** Turns 1 through this are counted. */
  turns: number;
  /** Mean over games of (mana spent ÷ mana available) across those turns. */
  mean: number;
  /** The median game. */
  median: number;
  /** The 10th-percentile game: the unlucky tenth. */
  p10: number;
}

/**
 * Per-turn and per-game mana bookkeeping for the castability run. A turn's
 * "available" is the pool after the land drop plus every unit a ramp spell
 * cast that turn added; "spent" is the units paid for spells.
 */
export class ManaTally {
  readonly spent: Float64Array;
  readonly available: Float64Array;
  private readonly ratios: number[] = [];
  private gameSpent = 0;
  private gameAvail = 0;

  constructor(
    maxTurn: number,
    private readonly turns: number
  ) {
    this.spent = new Float64Array(maxTurn + 1);
    this.available = new Float64Array(maxTurn + 1);
  }

  turn(turn: number, available: number, spent: number): void {
    this.spent[turn] += spent;
    this.available[turn] += available;
    if (turn <= this.turns) {
      this.gameSpent += spent;
      this.gameAvail += available;
    }
  }

  endGame(): void {
    this.ratios.push(this.gameAvail > 0 ? this.gameSpent / this.gameAvail : 0);
    this.gameSpent = 0;
    this.gameAvail = 0;
  }

  utilization(): Utilization {
    const sorted = [...this.ratios].sort((a, b) => a - b);
    const n = sorted.length;
    const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(n * q))];
    return {
      games: n,
      turns: this.turns,
      mean: sorted.reduce((a, b) => a + b, 0) / n,
      median: at(0.5),
      p10: at(0.1),
    };
  }
}
