import { usePlayStore } from '@/store/play';
import type { BoardLayout, SeatSlot } from './board-layouts';
import { clockPositionOf, usesClockStrip, type ClockPosition } from './clock-position';

export interface TurnControl {
  variant: 'bar' | 'chip';
  edge: 'top' | 'bottom';
}

/**
 * What the board draws for the table clock, from the per-device switches and
 * the clock position (2026-10-16): the edge strip (`bottom` / `top`), or the
 * game total in the hub plus a turn control on the active seat (`seat` bar,
 * `hub` chip).
 */
export function useClockPlacement(
  isActive: boolean,
  board: Pick<BoardLayout, 'seam' | 'rows'>,
  faces: boolean
): {
  position: ClockPosition;
  /** The strip to draw, or null on a hub-based position. */
  strip: 'bottom' | 'top' | null;
  /** The hub carries the game total. */
  hubShowsTime: boolean;
  /** The control a seat carries (only a live active seat gets one), or null.
   *  `edge` is the panel edge it sits on: the bottom, which faces the seat's
   *  own player, except on an unrotated board (desktop, online) where a seat
   *  whose bottom edge is the hub's row line takes the top edge, so the hub
   *  never covers the button. */
  turnFor: (slot: SeatSlot, live: boolean) => TurnControl | null;
  gameTimerEnabled: boolean;
  turnTrackerEnabled: boolean;
} {
  const gameTimerEnabled = usePlayStore((s) => s.gameTimerEnabled);
  const turnTrackerEnabled = usePlayStore((s) => s.turnTrackerEnabled);
  const position = clockPositionOf(usePlayStore((s) => s.clockPosition));
  const stripPosition = usesClockStrip(position);
  return {
    position,
    strip:
      stripPosition && (gameTimerEnabled || turnTrackerEnabled)
        ? (position as 'bottom' | 'top')
        : null,
    hubShowsTime: !stripPosition && gameTimerEnabled,
    turnFor: (slot, live) => {
      if (stripPosition || !turnTrackerEnabled || !isActive || !live) return null;
      const hubLine = 'row' in board.seam ? board.seam.row : board.rows / 2;
      const atHub = !faces && slot.row + (slot.rowSpan ?? 1) - 1 === hubLine;
      return { variant: position === 'seat' ? 'bar' : 'chip', edge: atHub ? 'top' : 'bottom' };
    },
    gameTimerEnabled,
    turnTrackerEnabled,
  };
}
