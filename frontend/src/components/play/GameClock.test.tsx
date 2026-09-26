// @vitest-environment happy-dom
/**
 * The table clock stops on the digit the tap found.
 *
 * It used to redraw on the wall clock's whole seconds, but a game's reading
 * turns over on its own second, counted from whenever it started. The digit
 * on screen lagged by up to a second, and a pause landed on that stale digit,
 * then ticked once more after the tap. These drive the real reducer under
 * fake timers with a start that sits mid-second.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGameState, makePlayer, type GameState } from '../../lib/game-state';
import { GameClock } from './GameClock';

vi.mock('../../lib/haptics', () => ({ haptics: { tap: vi.fn() } }));

const T0 = Date.UTC(2026, 8, 26, 20, 0, 0); // a whole second

function startedGame(startedAt: number): GameState {
  const state = createGameState({
    id: 'clock',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players: [0, 1].map((seat) =>
      makePlayer({ id: `p${seat}`, userId: null, seat, name: `P${seat}`, startingLife: 40 })
    ),
  });
  return { ...state, status: 'active', startedAt };
}

function Table({ initial }: { initial: GameState }) {
  const [game, setGame] = useState(initial);
  return (
    <GameClock
      game={game}
      dispatch={(a) => setGame((g) => applyAction(g, a))}
      canEdit
      showTotal
      showTurn={false}
    />
  );
}

// Each tick schedules the next from an effect, which React flushes at the end
// of `act`, so time advances in steps rather than one jump.
const run = (ms: number) => {
  for (let t = 0; t < ms; t += 50) act(() => vi.advanceTimersByTime(50));
};

const shown = () => document.querySelector('.game-clock-strip-fixed')?.textContent;

describe('the table clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('shows the current second, not the last wall-clock one', () => {
    render(<Table initial={startedGame(T0 - 300)} />); // started at x.7
    run(5_500); // 5.8s elapsed
    expect(shown()).toBe('Game 0:05');
    run(300); // 6.1s elapsed
    expect(shown()).toBe('Game 0:06');
  });

  it('freezes on the digit the pause found, and never ticks after it', () => {
    render(<Table initial={startedGame(T0 - 300)} />);
    run(5_900); // 6.2s elapsed: the wall clock last ticked at 5.3s
    expect(shown()).toBe('Game 0:06');
    fireEvent.click(screen.getByRole('button', { name: /^Pause the game clock/ }));
    expect(shown()).toBe('Game 0:06 (paused)');
    run(3_000);
    expect(shown()).toBe('Game 0:06 (paused)');
  });

  it('picks up from the paused digit on resume, on the new second boundary', () => {
    render(<Table initial={startedGame(T0 - 300)} />);
    run(5_900); // 6.2s
    fireEvent.click(screen.getByRole('button', { name: /^Pause the game clock/ }));
    run(10_450); // paused 10.45s
    fireEvent.click(screen.getByRole('button', { name: /^Resume the game clock/ }));
    expect(shown()).toBe('Game 0:06');
    run(750); // 6.95s
    expect(shown()).toBe('Game 0:06');
    run(100); // 7.05s
    expect(shown()).toBe('Game 0:07');
  });
});
