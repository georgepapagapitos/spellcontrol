// @vitest-environment happy-dom
/**
 * The turn marker, as something a table can actually find.
 *
 * Turn tracking existed before this and was invisible: `activeSeat` starts
 * null, the only way to set it was a seat's ⋯ menu, and the marker itself was
 * a thin ring that consequently never appeared. These pin the two affordances
 * that make it discoverable — the active seat's own "Turn" chip (which passes
 * on tap, rotated with their panel so it faces them) and the cold-start button
 * inside the table clock — and the conditions under which each must NOT show.
 *
 * Mirrors the mock harness in GameBoard.test.tsx; this file additionally turns
 * `showClock` on, since the board clock is half the subject.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function seat(n: number, name: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 }),
    ...over,
  };
}

function makeTestState(players: GamePlayer[], over: Partial<GameState> = {}): GameState {
  const state = createGameState({
    id: 'game-turn',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  // A started game: the clock derives everything from `startedAt`, so without
  // one there is nothing to render a control inside.
  return { ...state, status: 'active', startedAt: Date.now() - 60_000, ...over };
}

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({ stopPolling: vi.fn(), startPolling: vi.fn() }));
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      hapticsEnabled: false,
      setHaptics: vi.fn(),
      preferredLayouts: {},
      setPreferredLayout: vi.fn(),
      showClock: true,
      setShowClock: vi.fn(),
    });
  usePlayStore.getState = getState;
  return { usePlayStore };
});

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));

vi.mock('../../lib/use-wake-lock', () => ({ useWakeLock: vi.fn() }));

vi.mock('../../lib/undo-stack', () => ({
  capture: vi.fn(),
  clearUndo: vi.fn(),
  peekLabel: vi.fn(() => null),
  popRestore: vi.fn(() => []),
  runSuppressed: vi.fn((fn: () => void) => fn()),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  PointerSensor: class {},
  closestCenter: vi.fn(),
  useDraggable: () => ({ setNodeRef: vi.fn(), attributes: {}, listeners: {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { GameBoard } from './GameBoard';

const table = () => [seat(0, 'Alice'), seat(1, 'Bob')];
const passes = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls.map(([a]) => a as GameAction).filter((a) => a.type === 'pass-turn');

describe('turn chip — the active seat passes from their own panel', () => {
  it('shows on the active seat and nowhere else', () => {
    const game = makeTestState(table(), { activeSeat: 1 });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);

    expect(screen.getAllByRole('button', { name: /Pass to the next player/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Bob's turn/ })).toBeTruthy();
  });

  it('passes the turn on tap, crediting the seat it was tapped on', () => {
    const dispatch = vi.fn();
    const game = makeTestState(table(), { activeSeat: 1 });
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);

    fireEvent.click(screen.getByRole('button', { name: /Pass to the next player/ }));

    // No `toSeat`: passing means "advance from here", which is the reducer's
    // job. A targeted move is what the seat menu's "Start turn here" is for.
    expect(passes(dispatch)).toEqual([{ type: 'pass-turn', actorSeat: 1 }]);
  });

  it('stays away until a seat actually holds the turn', () => {
    render(<GameBoard game={makeTestState(table())} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('button', { name: /Pass to the next player/ })).toBeNull();
  });

  it('goes with the seat when it is eliminated, exactly like the ring', () => {
    const game = makeTestState([seat(0, 'Alice'), seat(1, 'Bob', { eliminated: true })], {
      activeSeat: 1,
    });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('button', { name: /Pass to the next player/ })).toBeNull();
  });
});

describe('table clock — the cold start for turn tracking', () => {
  it('offers a start button while no seat holds the turn', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(table())} dispatch={dispatch} canControlAll />);

    fireEvent.click(screen.getByRole('button', { name: 'Start tracking turns' }));
    expect(passes(dispatch)).toEqual([{ type: 'pass-turn', actorSeat: null, toSeat: 0 }]);
  });

  it('starts at whoever the table recorded as going first', () => {
    const dispatch = vi.fn();
    const game = makeTestState(table(), { startingSeat: 1 });
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);

    fireEvent.click(screen.getByRole('button', { name: 'Start tracking turns' }));
    expect(passes(dispatch)).toEqual([{ type: 'pass-turn', actorSeat: null, toSeat: 1 }]);
  });

  it('drops the button once turns are running — the chip owns passing from there', () => {
    const game = makeTestState(table(), { activeSeat: 0 });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('button', { name: 'Start tracking turns' })).toBeNull();
  });

  it('offers nothing on a finished game', () => {
    const game = makeTestState(table(), { status: 'finished', endedAt: Date.now() });
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('button', { name: 'Start tracking turns' })).toBeNull();
  });
});
