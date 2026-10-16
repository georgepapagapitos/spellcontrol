/**
 * Where the table clock lives on the board (2026-10-16 ruling). A per-device
 * preference, persisted in the play store next to the Game timer / Turn
 * tracker switches. The game total is shared, so it stays in one fixed place;
 * the turn control is personal, so on `seat` it follows the active seat.
 *
 * - `seat`: the game total sits in the center hub; the active seat carries an
 *   "End turn" bar on its own bottom edge.
 * - `hub`: the same hub total, with a compact turn chip on the active seat.
 * - `bottom` / `top`: the edge strip (2026-09-24), under the grid or above it
 *   turned to face the far side.
 */
export const CLOCK_POSITIONS = ['seat', 'bottom', 'top', 'hub'] as const;
export type ClockPosition = (typeof CLOCK_POSITIONS)[number];

export const DEFAULT_CLOCK_POSITION: ClockPosition = 'seat';

/** A stored value from an older or hand-edited blob reads as the default. */
export function clockPositionOf(value: unknown): ClockPosition {
  return CLOCK_POSITIONS.includes(value as ClockPosition)
    ? (value as ClockPosition)
    : DEFAULT_CLOCK_POSITION;
}

/** Positions that draw the edge strip. */
export function usesClockStrip(position: ClockPosition): boolean {
  return position === 'bottom' || position === 'top';
}

export const CLOCK_POSITION_OPTIONS: ReadonlyArray<{
  value: ClockPosition;
  label: string;
  hint: string;
}> = [
  {
    value: 'seat',
    label: 'Time in the center, End turn on the active seat',
    hint: 'The game time sits in the center button. A bar on the seat whose turn it is ends the turn.',
  },
  {
    value: 'bottom',
    label: 'Bottom edge',
    hint: 'One strip under the table with the game time, the turn time and the buttons.',
  },
  {
    value: 'top',
    label: 'Top edge',
    hint: 'The same strip above the table, turned to face the far side.',
  },
  {
    value: 'hub',
    label: 'Center hub',
    hint: 'The game time sits in the center button. A small chip on the active seat ends the turn.',
  },
];
