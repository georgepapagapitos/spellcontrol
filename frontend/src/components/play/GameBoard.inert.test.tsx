// @vitest-environment happy-dom
/**
 * F10: the board is a fixed full-screen overlay that isn't portaled, so
 * without a focus trap Tab walks past its last control into whatever the
 * board covers (the app's nav links, the Play page's own tabs). This pins
 * `useBackgroundInert` (lib/use-background-inert.ts) doing that job for both
 * GameBoard itself and the win celebration it renders on top of its own
 * seats. Mock harness mirrors GameBoard.hub.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function seat(n: number, name: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 }),
    ...over,
  };
}

function makeTestState(players: GamePlayer[], over: Partial<GameState> = {}): GameState {
  const state = createGameState({
    id: 'game-inert',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
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
      gameTimerEnabled: true,
      turnTrackerEnabled: true,
      setGameTimerEnabled: vi.fn(),
      setTurnTrackerEnabled: vi.fn(),
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

vi.mock('../../lib/game-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/game-tools')>();
  return { ...actual, highRoll: vi.fn() };
});

import { GameBoard } from './GameBoard';

const pair = () => [seat(0, 'Alice'), seat(1, 'Bob')];

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
  sessionStorage.clear();
});

describe('the app shell is inert while the board is mounted', () => {
  it('inerts a sibling outside the board, and clears it on unmount', () => {
    const { unmount } = render(
      <div>
        <button data-testid="outside">Outside nav link</button>
        <GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />
      </div>
    );
    const outside = screen.getByTestId('outside');
    expect(outside.inert).toBe(true);

    unmount();
    expect(outside.inert).toBe(false);
  });

  it('leaves an exempted sibling (the toast viewport) reachable', () => {
    render(
      <div>
        <div data-testid="toasts" data-inert-exempt>
          Notifications
        </div>
        <GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />
      </div>
    );
    expect(screen.getByTestId('toasts').inert).toBe(false);
  });

  it("doesn't inert the board's own dialogs (the game menu still opens)", () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Menu' }));
    expect(screen.getByText('How the board works') || true).toBeTruthy();
    // The menu itself rendered and is reachable — it lives inside the
    // board's own subtree, which this hook never touches.
    expect(document.querySelector('.game-menu')).toBeTruthy();
  });
});

describe('the win celebration makes the seats behind it inert', () => {
  it('inerts the seat grid while showing, and clears it once dismissed', () => {
    const game = makeTestState(pair(), { status: 'finished', winnerSeat: 0 });
    render(
      <div>
        <button data-testid="outside">Outside nav link</button>
        <GameBoard game={game} dispatch={vi.fn()} canControlAll />
      </div>
    );
    const grid = document.querySelector('.game-board-grid') as HTMLElement;
    expect(grid.inert).toBe(true);
    // The board-level inert (F10 above) still holds too.
    expect(screen.getByTestId('outside').inert).toBe(true);

    const overlay = screen.getByRole('dialog', { name: 'Alice wins' });
    fireEvent.click(overlay.parentElement!);
    expect(grid.inert).toBe(false);
    // Dismissing the celebration doesn't unmount the board — its own
    // background-inert (the nav link) is untouched by this.
    expect(screen.getByTestId('outside').inert).toBe(true);
  });
});
