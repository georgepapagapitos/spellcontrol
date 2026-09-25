// @vitest-environment happy-dom
/**
 * The board hub's radial petal ring (Lotus fan-out), plus the two table
 * moments it opens directly: board-level Restart and High Roll. Mock harness
 * mirrors GameBoard.gestures.test.tsx.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    id: 'game-hub',
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

import { highRoll } from '../../lib/game-tools';
import { GameBoard } from './GameBoard';

const pair = () => [seat(0, 'Alice'), seat(1, 'Bob')];

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
});

afterEach(() => {
  vi.mocked(highRoll).mockReset();
  vi.useRealTimers();
});

function openRing() {
  fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
}

describe('the hub ring', () => {
  it('fans out the five petals for a host, mid-game', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    const ring = screen.getByRole('menu', { name: 'Board menu' });
    expect(
      within(ring)
        .getAllByRole('menuitem')
        .map((el) => el.textContent)
    ).toEqual(['Restart', 'High roll', 'Players', 'Menu', 'Help']);
  });

  it('drops the host-only petals for a viewer who cannot control the table', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll={false} />);
    openRing();
    const ring = screen.getByRole('menu', { name: 'Board menu' });
    expect(
      within(ring)
        .getAllByRole('menuitem')
        .map((el) => el.textContent)
    ).toEqual(['High roll', 'Menu', 'Help']);
  });

  it('turns the hub into a close (✕) button while open', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Game menu' })).toBeTruthy();
  });

  it('closes on an outside tap', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.pointerDown(document.querySelector('.board-hub-backdrop')!);
    expect(screen.queryByRole('menu', { name: 'Board menu' })).toBeNull();
  });

  it('keeps the clock strip visible while open — it moved out of the seam, so a petal can never reach it', () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-clock-strip')).toBeTruthy();
    openRing();
    expect(document.querySelector('.game-clock-strip')).toBeTruthy();
  });

  // F12a: the hub button reads the triggering click's `detail` (0 for a
  // keyboard-synthesized click, >=1 for a real pointer click) and passes it
  // through as BoardHubMenu's `openedByKeyboard`.
  it("suppresses the first petal's ring on a pointer-triggered open, not on a keyboard one", () => {
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }), { detail: 1 });
    expect(
      document.querySelector('.board-hub-ring')?.classList.contains('board-hub-ring-pointer-opened')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }), { detail: 0 });
    expect(
      document.querySelector('.board-hub-ring')?.classList.contains('board-hub-ring-pointer-opened')
    ).toBe(false);
  });
});

describe('Restart, reached from the ring', () => {
  it('asks first, then dispatches reset', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    expect(screen.getByText('Restart the game?')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Restart the game?')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();

    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'reset' });
  });
});

describe('High Roll, reached from the ring', () => {
  it('shows each seat its own d20 and marks the winner', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: 11, 1: 20 }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    const overlays = document.querySelectorAll('.pp-highroll');
    expect(overlays).toHaveLength(2);
    expect(overlays[0].textContent).toContain('11');
    expect(overlays[1].textContent).toContain('20');
    expect(overlays[1].classList.contains('is-winner')).toBe(true);
    expect(overlays[1].textContent).toContain('goes first');
  });

  it('records the winner exactly like the quiet first-player tool', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: 11, 1: 20 }, winnerSeat: 1 });
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    const sent = dispatch.mock.calls.map(([a]) => a as GameAction);
    expect(sent).toContainEqual({ type: 'settings', patch: { startingSeat: 1 } });
    expect(sent).toContainEqual({ type: 'pass-turn', actorSeat: null, toSeat: 1 });
  });

  it('freezes every panel’s life taps while showing', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: 11, 1: 20 }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));

    for (const btn of screen.getAllByRole('button', { name: '+1 life' })) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('dismisses on a tap without leaking into a life change', () => {
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: 11, 1: 20 }, winnerSeat: 1 });
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pair())} dispatch={dispatch} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));
    dispatch.mockClear();

    fireEvent.click(document.querySelectorAll('.pp-highroll')[0]);
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'life' }));
  });

  it('dismisses itself after a few seconds', () => {
    vi.useFakeTimers();
    vi.mocked(highRoll).mockReturnValue({ rolls: { 0: 11, 1: 20 }, winnerSeat: 1 });
    render(<GameBoard game={makeTestState(pair())} dispatch={vi.fn()} canControlAll />);
    openRing();
    fireEvent.click(screen.getByRole('menuitem', { name: 'High roll' }));
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(4001);
    });
    expect(document.querySelectorAll('.pp-highroll')).toHaveLength(0);
  });
});
