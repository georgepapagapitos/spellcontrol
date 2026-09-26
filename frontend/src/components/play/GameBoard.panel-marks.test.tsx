// @vitest-environment happy-dom
/**
 * What a seat marks on itself: the host ★ (online only) and the vertical tap
 * areas class that moves the ± hints onto the vertical axis. The CSS half of
 * the vertical hints is pinned in styles/play-vertical-taps.test.ts.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

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

import { GameBoard } from './GameBoard';

function seat(seatNo: number, name: string, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({ id: `p${seatNo}`, userId: null, seat: seatNo, name, startingLife: 40 }),
    ...overrides,
  };
}

function game(mode: 'local' | 'online', extra: Partial<GameState> = {}): GameState {
  const state = createGameState({
    id: 'game-marks',
    code: mode === 'online' ? 'ABCD' : '',
    mode,
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players: [seat(0, 'Alice', { isHost: true }), seat(1, 'Bob')],
  });
  return { ...state, status: 'active', ...extra };
}

describe('the host mark', () => {
  it('is not drawn on a local board, where seat 0 is "host" only by construction', () => {
    render(<GameBoard game={game('local')} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByLabelText('host')).toBeNull();
    expect(document.querySelector('.player-panel-host')).toBeNull();
  });

  it('marks the host of an online game, who controls the table', () => {
    render(<GameBoard game={game('online')} dispatch={vi.fn()} canControlAll />);
    const star = screen.getByLabelText('host');
    expect(star.closest('.player-panel')?.getAttribute('data-seat')).toBe('0');
  });
});

describe('vertical tap areas', () => {
  it('marks every seat so the ± hints follow the zones onto the vertical axis', () => {
    render(
      <GameBoard
        game={game('local', { tapOrientation: 'vertical' })}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    const panels = document.querySelectorAll('.player-panel[data-seat]');
    expect(panels).toHaveLength(2);
    for (const p of panels) {
      expect(p.classList.contains('is-vertical-taps')).toBe(true);
      expect(p.querySelector('.player-panel-tapzone.is-top')).not.toBeNull();
    }
  });

  it('leaves a horizontal board unmarked', () => {
    render(<GameBoard game={game('local')} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.is-vertical-taps')).toBeNull();
  });
});
