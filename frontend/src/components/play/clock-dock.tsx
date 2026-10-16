import { ChevronRight, Pause, Play } from 'lucide-react';
import { isClockPaused, type GameAction, type GameState } from '@spellcontrol/game-core';
import { isClockWaiting } from '@/lib/play/game-clock';
import type { HubPetal } from './BoardHubMenu';

/**
 * The clock's controls in the hub menu's actions row (the pills over the
 * dock), for the clock positions that draw no edge strip (`seat`, `hub`;
 * 2026-10-16): Pause/Resume, or Start clock while the clock still waits for
 * the first turn, and Start turns before any seat holds the turn. Not in the
 * ring: an eighth key would force a radius that does not fit a 320px board.
 * Not in the dock either: five dock items wrapped every label on a phone.
 */
export function buildClockDock({
  game,
  dispatch,
  canEdit,
  showTotal,
  showTurn,
  icon,
}: {
  game: GameState;
  dispatch: (a: GameAction) => void;
  canEdit: boolean;
  showTotal: boolean;
  showTurn: boolean;
  icon: { width: number; height: number; strokeWidth: number; 'aria-hidden': true };
}): HubPetal[] {
  if (!canEdit || game.status !== 'active') return [];
  const paused = isClockPaused(game);
  const startSeat = game.startingSeat ?? game.players.find((p) => !p.eliminated)?.seat ?? null;
  const items: HubPetal[] = [];
  if (showTotal) {
    items.push(
      isClockWaiting(game)
        ? {
            id: 'clock-start',
            label: 'Start now',
            icon: <Play {...icon} />,
            onSelect: () => dispatch({ type: 'clock-start' }),
          }
        : {
            id: 'clock-pause',
            label: paused ? 'Resume' : 'Pause',
            icon: paused ? <Play {...icon} /> : <Pause {...icon} />,
            onSelect: () => dispatch({ type: 'clock', paused: !paused, actorSeat: null }),
          }
    );
  }
  if (showTurn && game.activeSeat == null && startSeat != null) {
    items.push({
      id: 'turn-start',
      label: 'Start turns',
      icon: <ChevronRight {...icon} />,
      onSelect: () => dispatch({ type: 'pass-turn', actorSeat: null, toSeat: startSeat }),
    });
  }
  return items;
}
