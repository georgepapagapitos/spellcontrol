import { ChevronRight, Pause } from 'lucide-react';
import { isClockPaused, type GameAction, type GameState } from '@spellcontrol/game-core';
import { describeClock, formatClock, msToNextSecond, turnElapsed } from '@/lib/play/game-clock';
import { haptics } from '@/lib/util/haptics';
import { useNow } from '@/lib/util/use-now';

/**
 * The turn control that follows the turn (2026-10-16 clock-position ruling).
 * The game total is shared, so it lives in one place (the hub, or the edge
 * strip); the turn is personal, so on the `seat` and `hub` clock positions it
 * sits on whichever seat holds it, inside that seat's panel and so rotated to
 * face them like everything else on the seat.
 *
 * - `bar`: a full-width bar along the seat's bottom edge, that turn's time and
 *   "End turn". The label drops to the chevron on a narrow seat (container
 *   query on the wrapper, see `.pp-turn-bar-wrap`), the 44px target stays.
 * - `chip`: the compact form for the `hub` position, time and a pass chevron.
 *
 * `canPass` false (a viewer who may not edit) keeps the readout and drops the
 * button. Passing dispatches the same `pass-turn` the edge strip's Pass does.
 */
export function TurnBar({
  game,
  dispatch,
  seat,
  name,
  variant,
  edge,
  canPass,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  seat: number;
  name: string;
  variant: 'bar' | 'chip';
  /** The panel edge it sits on; see `useClockPlacement`. */
  edge: 'top' | 'bottom';
  canPass: boolean;
}) {
  const finished = game.status === 'finished';
  const paused = isClockPaused(game);
  const now = useNow(!finished && !paused, (t) => msToNextSecond(turnElapsed(game, t)));
  const turn = turnElapsed(game, now) ?? 0;
  const time = formatClock(turn);
  const body = (
    <>
      {paused && <Pause className="pp-turn-bar-paused" width={12} height={12} aria-hidden />}
      <span className="pp-turn-bar-time">{time}</span>
      {canPass && (
        <span className="pp-turn-bar-cta">
          {variant === 'bar' && <span className="pp-turn-bar-label">End turn</span>}
          <ChevronRight width={16} height={16} strokeWidth={2} aria-hidden />
        </span>
      )}
    </>
  );
  const wrapClass = `pp-turn-bar-wrap is-${variant}${edge === 'top' ? ' is-top-edge' : ''}`;
  const barClass = `pp-turn-bar is-${variant}${paused ? ' is-paused' : ''}`;
  return (
    <div className={wrapClass}>
      {canPass ? (
        <button
          type="button"
          className={barClass}
          aria-label={`End ${name}'s turn, ${describeClock(turn)} so far${paused ? ', paused' : ''}`}
          // The seat's tap zones sit under this; a press here is never a life tap.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            haptics.tap();
            dispatch({ type: 'pass-turn', actorSeat: seat });
          }}
        >
          {body}
        </button>
      ) : (
        <div className={barClass} role="img" aria-label={`${name}'s turn, ${describeClock(turn)}`}>
          {body}
        </div>
      )}
    </div>
  );
}
