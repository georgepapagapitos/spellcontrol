/**
 * Pure helpers for the pre-game / table tools (coin flip, dice, random
 * first player). Kept side-effect free so the randomness source is
 * injectable and the results are unit-testable. The UI layer turns these
 * into `note` events on the game log — no new reducer action types, so
 * online games need zero backend changes.
 */

/** Default to crypto-grade randomness; falls back to Math.random. */
function defaultRandom(): number {
  if (typeof globalThis.crypto !== 'undefined' && 'getRandomValues' in globalThis.crypto) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 0x1_0000_0000;
  }
  return Math.random();
}

export type RandomFn = () => number;

/** Inclusive integer in [min, max]. */
export function randInt(min: number, max: number, rand: RandomFn = defaultRandom): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export type CoinSide = 'Heads' | 'Tails';

export function flipCoin(rand: RandomFn = defaultRandom): CoinSide {
  return rand() < 0.5 ? 'Heads' : 'Tails';
}

export interface DiceRoll {
  sides: number;
  count: number;
  rolls: number[];
  total: number;
}

/** Roll `count` dice of `sides` faces. count/sides are clamped to sane bounds. */
export function rollDice(sides: number, count = 1, rand: RandomFn = defaultRandom): DiceRoll {
  const s = Math.max(2, Math.min(1000, Math.floor(sides) || 6));
  const n = Math.max(1, Math.min(20, Math.floor(count) || 1));
  const rolls = Array.from({ length: n }, () => randInt(1, s, rand));
  return { sides: s, count: n, rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

/** Common physical-table die faces, in display order. */
export const DIE_PRESETS = [4, 6, 8, 10, 12, 20] as const;

export interface FirstPlayerPick {
  seat: number;
  name: string;
}

/**
 * Pick a random starting player among the still-in seats. Eliminated seats
 * are skipped so a mid-game "who goes first next game" still works; if every
 * seat is eliminated we fall back to the full roster.
 */
export function pickFirstPlayer(
  players: { seat: number; name: string; eliminated: boolean }[],
  rand: RandomFn = defaultRandom
): FirstPlayerPick | null {
  if (players.length === 0) return null;
  const pool = players.filter((p) => !p.eliminated);
  const choices = pool.length > 0 ? pool : players;
  const pick = choices[randInt(0, choices.length - 1, rand)];
  return { seat: pick.seat, name: pick.name };
}

/** Human-readable log line for a dice roll. */
export function describeRoll(r: DiceRoll): string {
  const spec = `${r.count}d${r.sides}`;
  if (r.count === 1) return `🎲 ${spec} → ${r.total}`;
  return `🎲 ${spec} → [${r.rolls.join(', ')}] = ${r.total}`;
}

export interface HighRollResult {
  /** Every rolling seat's full roll history: index 0 is its first roll, and
   *  any further entries are re-rolls from a tiebreak round it took part in,
   *  in order — so the seat's decisive value is always the LAST entry. A
   *  seat that never tied has a single-element array. Keeping the whole
   *  history (not just the final value) is what lets the UI show a tied
   *  seat's first roll alongside its tiebreak(s), so a winner who re-rolled
   *  low never reads as lower than a loser's single high roll. */
  rolls: Record<number, number[]>;
  winnerSeat: number;
}

/**
 * The board-level "High Roll" table moment: a d20 per living seat at once,
 * ties re-rolling only among the tied seats until one winner remains. Same
 * skip-eliminated-seats fallback as `pickFirstPlayer` (whose full roster the
 * table still wants a starting seat from once everyone's out).
 */
export function highRoll(
  players: { seat: number; eliminated: boolean }[],
  rand: RandomFn = defaultRandom
): HighRollResult | null {
  const living = players.filter((p) => !p.eliminated);
  const pool = living.length > 0 ? living : players;
  if (pool.length === 0) return null;
  const rolls: Record<number, number[]> = {};
  for (const p of pool) rolls[p.seat] = [];
  let contenders = pool.map((p) => p.seat);
  for (;;) {
    for (const seat of contenders) rolls[seat].push(randInt(1, 20, rand));
    const max = Math.max(...contenders.map((s) => rolls[s][rolls[s].length - 1]));
    const tied = contenders.filter((s) => rolls[s][rolls[s].length - 1] === max);
    if (tied.length === 1) return { rolls, winnerSeat: tied[0] };
    contenders = tied;
  }
}
