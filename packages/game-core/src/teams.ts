// Two-Headed Giant: teams of two share one life total and one poison total.
// Split out of index.ts (which re-exports it).

/** Team life every 2HG team starts on. */
export const TWO_HEADED_GIANT_LIFE = 30;

/** A 2HG team loses at fifteen poison counters, not ten. */
export const TWO_HEADED_GIANT_POISON = 15;

/** Poison counters that eliminate a player (or a 2HG team) in this format. */
export function poisonLimit(format: string): number {
  return format === '2hg' ? TWO_HEADED_GIANT_POISON : 10;
}

/**
 * The team a seat belongs to: seats 0 and 1 are team 0, seats 2 and 3 team 1,
 * and so on. A fixed rule rather than a stored field, so a seating change
 * (reseat) re-teams the table with no second field to keep in step.
 */
export function teamOf(seat: number): number {
  return Math.floor(seat / 2);
}

/** Two-Headed Giant needs whole teams: an even seat count of at least four. */
export function hasWholeTeams(seats: number): boolean {
  return seats >= 4 && seats % 2 === 0;
}

/** Whether a seat is on the winning side: the winner, or in 2HG its teammate. */
export function isWinningSeat(
  state: { format: string; winnerSeat: number | null },
  seat: number
): boolean {
  if (state.winnerSeat === null) return false;
  if (state.winnerSeat === seat) return true;
  return state.format === '2hg' && teamOf(state.winnerSeat) === teamOf(seat);
}
