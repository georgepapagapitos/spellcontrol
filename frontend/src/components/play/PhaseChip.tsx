import type { GameAction, GamePhase } from '../../lib/game-state';
import { GAME_PHASES } from '../../lib/game-state';
import { haptics } from '../../lib/haptics';
import './PhaseChip.css';

const PHASE_LABELS: Record<GamePhase, string> = {
  beginning: 'Beginning',
  main1: 'Main 1',
  combat: 'Combat',
  main2: 'Main 2',
  end: 'End',
};

/**
 * Advisory turn-structure clock — a life pad, not a rules engine, so it
 * never blocks anything: it's a chip plus a tap. `phase` absent means the
 * clock hasn't been started, and only the active seat's own device gets the
 * (subtle, opt-in) start affordance; every other seat sees nothing at all
 * until it's running. Once running, the phase name is visible to every seat,
 * but only the active seat's own device can advance it — 'end' can't advance
 * further from here, since turn-passing is what resets the clock
 * server-side, not another wrap of this chip.
 *
 * Shared by `OnlineGameView` (`/play`) and the playtest board's `ActionBar`
 * (seated online) — one component, so its gating logic can't drift between
 * the two surfaces. Deliberately decoupled from `GameState`/`GamePlayer`
 * shape: callers pass just the fields this needs.
 */
export function PhaseChip({
  phase,
  activeSeat,
  mySeat,
  dispatch,
}: {
  phase: GamePhase | undefined;
  activeSeat: number | null;
  /** This device's own seat number, or null when unseated (spectating). */
  mySeat: number | null;
  dispatch(action: GameAction): void;
}) {
  const isActiveOwner = mySeat != null && activeSeat === mySeat;

  if (phase === undefined) {
    if (!isActiveOwner || mySeat == null) return null;
    return (
      <button
        type="button"
        className="ogv-phase-start"
        onClick={() => dispatch({ type: 'phase', phase: 'beginning', actorSeat: mySeat })}
      >
        Start the phase clock
      </button>
    );
  }

  const label = PHASE_LABELS[phase];

  if (!isActiveOwner || mySeat == null) {
    return (
      <span className="ogv-phase-chip" aria-label={`Phase: ${label}`} role="group">
        <span role="status">{label}</span>
      </span>
    );
  }

  const canAdvance = phase !== 'end';
  const advance = () => {
    const next = GAME_PHASES[GAME_PHASES.indexOf(phase) + 1];
    if (!next) return;
    dispatch({ type: 'phase', phase: next, actorSeat: mySeat });
    haptics.tap();
  };

  return (
    <button
      type="button"
      className="ogv-phase-chip ogv-phase-chip--tappable"
      aria-label={canAdvance ? `Phase: ${label}. Tap to advance.` : `Phase: ${label}`}
      disabled={!canAdvance}
      onClick={advance}
    >
      <span role="status">{label}</span>
    </button>
  );
}
