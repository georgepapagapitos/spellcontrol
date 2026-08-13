// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`/`.toHaveAccessibleName()`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';
import { TableMoments } from './TableMoments';
import type { OnlineTable } from '../hooks/use-online-table';

vi.mock('@/lib/haptics', () => ({
  haptics: {
    tap: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    lethal: vi.fn(),
    eliminate: vi.fn(),
    bump: vi.fn(),
  },
}));
import { haptics } from '@/lib/haptics';

/** Forces the win ceremony's dismiss paths to resolve synchronously instead
 *  of waiting on a CSS `animationend` (happy-dom doesn't drive real CSS
 *  animations) — mirrors OpponentBoardModal.test.tsx's identical helper. */
function mockReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
  );
}

function onlineGame(overrides: Partial<GameState> = {}): GameState {
  const g = createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me-id',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
        colorIdentity: ['U'],
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), ...overrides };
}

function table(overrides: Partial<OnlineTable> = {}): OnlineTable {
  return { activeSeat: null, opponents: [], mySeat: 0, ...overrides };
}

beforeEach(() => {
  usePlayStore.setState({ online: onlineGame() });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TableMoments — "Your turn" moment', () => {
  it('does not fire on mount, even when activeSeat already equals mySeat', () => {
    render(<TableMoments onlineTable={table({ activeSeat: 0, mySeat: 0 })} />);
    expect(document.body.querySelector('.table-moment')).toBeNull();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('fires when activeSeat changes to mySeat, announced and haptic', () => {
    const { rerender } = render(<TableMoments onlineTable={table({ activeSeat: 1, mySeat: 0 })} />);
    rerender(<TableMoments onlineTable={table({ activeSeat: 0, mySeat: 0 })} />);
    const moment = document.body.querySelector('.table-moment');
    expect(moment).not.toBeNull();
    expect(moment!.getAttribute('role')).toBe('status');
    expect(moment!.textContent).toContain('Your turn');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('does not fire when activeSeat changes to a seat that is not mine', () => {
    const { rerender } = render(
      <TableMoments onlineTable={table({ activeSeat: null, mySeat: 0 })} />
    );
    rerender(<TableMoments onlineTable={table({ activeSeat: 1, mySeat: 0 })} />);
    expect(document.body.querySelector('.table-moment')).toBeNull();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('auto-dismisses and never re-fires for a repeated identical activeSeat', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <TableMoments onlineTable={table({ activeSeat: 1, mySeat: 0 })} />
      );
      rerender(<TableMoments onlineTable={table({ activeSeat: 0, mySeat: 0 })} />);
      expect(document.body.querySelector('.table-moment')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(document.body.querySelector('.table-moment')).toBeNull();

      // Re-render with the SAME activeSeat value — must not restart it.
      rerender(<TableMoments onlineTable={table({ activeSeat: 0, mySeat: 0 })} />);
      expect(document.body.querySelector('.table-moment')).toBeNull();
      expect(haptics.success).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TableMoments — win ceremony', () => {
  it('renders nothing while the online game has not finished', () => {
    usePlayStore.setState({ online: onlineGame() });
    render(<TableMoments onlineTable={table()} />);
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();
  });

  it('does not celebrate on mount into an already-finished game (no transition observed)', () => {
    usePlayStore.setState({ online: onlineGame({ status: 'finished', winnerSeat: 0 }) });
    render(<TableMoments onlineTable={table()} />);
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('celebrates on the active → finished transition, naming the winner', () => {
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = render(<TableMoments onlineTable={table()} />);

    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: 1 }) });
    });
    rerender(<TableMoments onlineTable={table()} />);

    const ceremony = document.body.querySelector('.table-win-ceremony');
    expect(ceremony).not.toBeNull();
    expect(ceremony!.textContent).toContain('Rival wins');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('shows a draw as "Game over", not a fabricated winner', () => {
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = render(<TableMoments onlineTable={table()} />);

    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: null }) });
    });
    rerender(<TableMoments onlineTable={table()} />);

    expect(document.body.querySelector('.table-win-ceremony')!.textContent).toContain('Game over');
  });

  it('is dismissible via the explicit close control, and does not trap focus', () => {
    mockReducedMotion(true); // resolves the dismiss synchronously — see helper doc comment
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = render(<TableMoments onlineTable={table()} />);
    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: 1 }) });
    });
    rerender(<TableMoments onlineTable={table()} />);

    expect(document.body.querySelector('[aria-modal]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();
  });

  it('is dismissible via a tap anywhere on the ceremony', () => {
    mockReducedMotion(true);
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = render(<TableMoments onlineTable={table()} />);
    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: 1 }) });
    });
    rerender(<TableMoments onlineTable={table()} />);

    fireEvent.click(document.body.querySelector('.table-win-backdrop')!);
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();
  });

  it('does not re-celebrate on a re-render while status stays finished', () => {
    mockReducedMotion(true);
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = render(<TableMoments onlineTable={table()} />);
    const finished = applyAction(active, { type: 'end', winnerSeat: 1 });
    act(() => {
      usePlayStore.setState({ online: finished });
    });
    rerender(<TableMoments onlineTable={table()} />);
    expect(haptics.success).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();

    // A re-render with the SAME 'finished' status (e.g. an unrelated life
    // tick elsewhere at the table) must not reopen the dismissed ceremony.
    act(() => {
      usePlayStore.setState({ online: { ...finished, updatedAt: finished.updatedAt + 1 } });
    });
    rerender(<TableMoments onlineTable={table()} />);
    expect(document.body.querySelector('.table-win-ceremony')).toBeNull();
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });
});
