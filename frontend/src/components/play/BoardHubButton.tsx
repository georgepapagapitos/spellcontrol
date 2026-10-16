import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { Menu, Pause, Swords, X } from 'lucide-react';
import { isClockPaused, type GameState } from '@spellcontrol/game-core';
import {
  clockView,
  formatClock,
  gameElapsed,
  msToNextSecond,
  turnElapsed,
} from '@/lib/play/game-clock';
import { useNow } from '@/lib/util/use-now';

/**
 * The center hub: the table-menu button, and on the `seat` / `hub` clock
 * positions (2026-10-16) the one place the shared game total lives. With the
 * total on it widens from a circle to a stamped rect (buttons are rects,
 * STYLE_GUIDE § Shape language) holding the menu glyph beside "12:04" over a
 * small word: "game", or the state when the clock isn't simply running
 * ("paused", "not started"). Open (the ring's ✕) or in commander-damage mode it
 * is the round button again, so the ring's geometry and the gold dagger read
 * as they always did; the hub is centered on the seam either way.
 *
 * Its own component so the once-a-second tick re-renders this button, not the
 * whole board.
 */
export function BoardHubButton({
  hubRef,
  game,
  showTime,
  stacked,
  cmdFocus,
  open,
  style,
  onClick,
}: {
  hubRef: RefObject<HTMLButtonElement | null>;
  game: GameState;
  /** The game timer is on and the clock position puts the total in the hub. */
  showTime: boolean;
  /** A column seam: the hub sits between side-by-side seats, so the readout
   *  stacks (menu glyph over the time over the word) and stays narrow rather
   *  than reach over either seat's numeral. */
  stacked: boolean;
  cmdFocus: boolean;
  open: boolean;
  style: CSSProperties;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const finished = game.status === 'finished';
  const now = useNow(showTime && !finished && !isClockPaused(game), (t) =>
    msToNextSecond(gameElapsed(game, t), game.activeSeat != null ? turnElapsed(game, t) : null)
  );
  const view = clockView(game, now);
  const timed = showTime && view.total != null && !cmdFocus && !open;
  const state = timed ? (view.waiting ? 'waiting' : view.paused ? 'paused' : 'game') : null;
  const label = cmdFocus
    ? 'Return to game'
    : open
      ? 'Close menu'
      : timed && view.total != null
        ? `Game menu. Game ${formatClock(view.total)}${
            view.waiting ? ', waiting for the first turn' : view.paused ? ', paused' : ''
          }`
        : 'Game menu';
  return (
    <button
      type="button"
      ref={hubRef}
      className={`game-board-menu-btn${cmdFocus ? ' is-cmd' : ''}${timed ? ' has-time' : ''}${timed && stacked ? ' is-stacked' : ''}${
        timed && view.paused ? ' is-paused' : ''
      }`}
      style={style}
      aria-label={label}
      aria-haspopup={cmdFocus ? undefined : 'menu'}
      aria-expanded={cmdFocus ? undefined : open}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {cmdFocus ? (
        <Swords width={22} height={22} strokeWidth={2.2} aria-hidden />
      ) : open ? (
        <X width={22} height={22} strokeWidth={2.2} aria-hidden />
      ) : (
        <Menu width={timed ? 18 : 22} height={timed ? 18 : 22} strokeWidth={2} aria-hidden />
      )}
      {timed && view.total != null && (
        <span className="game-board-menu-time" aria-hidden="true">
          <span className="game-board-menu-time-value">{formatClock(view.total)}</span>
          <span className="game-board-menu-time-label">
            {view.paused && !view.waiting && (
              <Pause width={12} height={12} strokeWidth={2} aria-hidden />
            )}
            {state}
          </span>
        </span>
      )}
    </button>
  );
}
