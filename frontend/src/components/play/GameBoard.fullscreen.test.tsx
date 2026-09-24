// @vitest-environment happy-dom
/**
 * The board offers fullscreen on the first tap, touch devices only (see
 * lib/use-fullscreen.ts for the hook itself — this covers only the "first
 * gesture on the board" wiring in GameBoard).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function seat(n: number, name: string): GamePlayer {
  return makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 });
}

function makeTestState(players: GamePlayer[]): GameState {
  const state = createGameState({
    id: 'game-fullscreen',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return { ...state, status: 'active', startedAt: Date.now() - 60_000 };
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
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const enter = vi.fn();
vi.mock('../../lib/use-fullscreen', () => ({
  useFullscreen: () => ({
    supported: true,
    isFullscreen: false,
    enter,
    exit: vi.fn(),
    toggle: vi.fn(),
  }),
}));

import { GameBoard } from './GameBoard';

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
  enter.mockClear();
});

describe('fullscreen on the first board gesture', () => {
  it('requests fullscreen on the very first tap anywhere on the board', () => {
    render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob')])}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    const zone = screen.getAllByLabelText('+1 life')[0];
    fireEvent.pointerDown(zone, { pointerId: 1 });
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('only offers it once per board mount, not on every tap', () => {
    render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob')])}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    const zone = screen.getAllByLabelText('+1 life')[0];
    fireEvent.pointerDown(zone, { pointerId: 1 });
    fireEvent.pointerUp(zone, { pointerId: 1 });
    fireEvent.pointerDown(zone, { pointerId: 2 });
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('fires even when the tap lands on the hub, which stops propagation', () => {
    render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob')])}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Game menu' }));
    expect(enter).toHaveBeenCalledTimes(1);
  });
});
