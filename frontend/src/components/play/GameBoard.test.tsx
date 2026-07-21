// @vitest-environment happy-dom
/**
 * Share recap — the finished-game entry point that opens the existing
 * ShareDialog pre-configured for kind='game-result'. Mirrors the mock
 * harness already proven out by GameBoard.ux321.test.tsx (GameBoard
 * unconditionally touches usePlayStore/haptics/wake-lock/undo-stack/dnd-kit
 * regardless of scenario) — this file adds its own describe block rather
 * than growing that ticket-scoped file.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function makeTestPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: 'p0', userId: null, seat: 0, name: 'Alice', startingLife: 40 }),
    ...overrides,
  };
}

function makeTestState(
  players: GamePlayer[],
  opts: { mode?: 'local' | 'online'; status?: GameState['status']; winnerSeat?: number | null } = {}
): GameState {
  const state = createGameState({
    id: 'game-test',
    code: opts.mode === 'online' ? 'ABCD' : '',
    mode: opts.mode ?? 'online',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players,
  });
  return {
    ...state,
    status: opts.status ?? 'finished',
    winnerSeat: opts.winnerSeat ?? 0,
  };
}

vi.mock('../../store/play', () => {
  const getState = vi.fn(() => ({ stopPolling: vi.fn(), startPolling: vi.fn() }));
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      hapticsEnabled: false,
      setHaptics: vi.fn(),
      preferredLayouts: {},
      setPreferredLayout: vi.fn(),
    });
  usePlayStore.getState = getState;
  return { usePlayStore };
});

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn() },
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

const { shareDialogSpy } = vi.hoisted(() => ({ shareDialogSpy: vi.fn() }));
vi.mock('../ShareDialog', () => ({
  ShareDialog: (props: unknown) => {
    shareDialogSpy(props);
    return <div data-testid="share-dialog-mock" />;
  },
}));

import { GameBoard } from './GameBoard';

function renderFinished(game: GameState) {
  // canControlAll=false keeps the render surface to what every test here
  // actually exercises (the isFinished action row is shown to any viewer,
  // never gated on host control) — the host-only roster/layout sections
  // never mount, which this suite doesn't otherwise need.
  render(<GameBoard game={game} dispatch={vi.fn()} canControlAll={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
}

describe('Share recap entry point', () => {
  it('renders for a finished online game with a winner', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'online',
      status: 'finished',
      winnerSeat: 0,
    });
    renderFinished(game);
    expect(screen.getByRole('button', { name: 'Share recap' })).toBeTruthy();
  });

  it('renders for a finished online game with no declared winner', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'online',
      status: 'finished',
      winnerSeat: null,
    });
    renderFinished(game);
    expect(screen.getByRole('button', { name: 'Share recap' })).toBeTruthy();
  });

  it('is absent for a finished local game', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'local',
      status: 'finished',
      winnerSeat: 0,
    });
    renderFinished(game);
    expect(screen.queryByRole('button', { name: 'Share recap' })).toBeNull();
  });

  it('is absent for an in-progress online game', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'online',
      status: 'active',
      winnerSeat: null,
    });
    renderFinished(game);
    expect(screen.queryByRole('button', { name: 'Share recap' })).toBeNull();
  });

  it('is absent for an in-progress local game', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'local',
      status: 'active',
      winnerSeat: null,
    });
    renderFinished(game);
    expect(screen.queryByRole('button', { name: 'Share recap' })).toBeNull();
  });

  it('mounts ShareDialog with kind=game-result and the session id as resourceId', () => {
    const game = makeTestState([makeTestPlayer()], {
      mode: 'online',
      status: 'finished',
      winnerSeat: 0,
    });
    renderFinished(game);
    fireEvent.click(screen.getByRole('button', { name: 'Share recap' }));

    expect(screen.getByTestId('share-dialog-mock')).toBeTruthy();
    expect(shareDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'game-result',
        resourceId: 'game-test',
        resourceLabel: 'this game',
      })
    );
  });
});
