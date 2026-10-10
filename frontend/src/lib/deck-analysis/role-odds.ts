/**
 * "Do I run enough?" as a chance, for the Roles panel: the exact odds of
 * holding at least one card of a role by the turn it matters, on the play,
 * before any mulligan. Hypergeometric, so no simulation and no noise: the same
 * deck always reads the same number.
 */

export type OddsRole = 'ramp' | 'removal' | 'boardwipe' | 'cardDraw';

/** The turn each role has to show up by: ramp early, answers and engines mid-game, wipes late. */
export const ROLE_ODDS_TURN: Record<OddsRole, number> = {
  ramp: 2,
  removal: 4,
  cardDraw: 4,
  boardwipe: 6,
};

const OPENING_HAND = 7;

/** Cards seen by `turn` on the play: the opening seven, then a draw from turn 2 on. */
export function cardsSeenOnThePlay(turn: number): number {
  return OPENING_HAND + Math.max(0, turn - 1);
}

/** P(at least one of `copies` cards among `seen` drawn from a library of `librarySize`). */
export function chanceOfAtLeastOne(librarySize: number, copies: number, seen: number): number {
  if (copies <= 0 || librarySize <= 0 || seen <= 0) return 0;
  const drawn = Math.min(seen, librarySize);
  if (copies >= librarySize || drawn > librarySize - copies) return 1;
  // P(none) = prod over the draws of (N - K - i) / (N - i).
  let none = 1;
  for (let i = 0; i < drawn; i++) none *= (librarySize - copies - i) / (librarySize - i);
  return 1 - none;
}

/** Odds for a role by its own turn, 0-1; null when there's nothing to compute. */
export function roleOdds(
  role: OddsRole,
  copies: number,
  librarySize: number | undefined
): { turn: number; chance: number } | null {
  if (!librarySize || copies <= 0) return null;
  const turn = ROLE_ODDS_TURN[role];
  return { turn, chance: chanceOfAtLeastOne(librarySize, copies, cardsSeenOnThePlay(turn)) };
}

/** A whole percent, never rounding a near miss up to a sure thing or down to impossible. */
export function formatChance(chance: number): string {
  const pct = chance * 100;
  if (pct >= 99.5 && chance < 1) return '>99%';
  if (pct < 0.5 && chance > 0) return '<1%';
  return `${Math.round(pct)}%`;
}
