// @vitest-environment happy-dom
/**
 * End-to-end check that the board actually wires `useFullscreen`'s
 * `exitOnUnmount` correctly — unlike GameBoard.fullscreen.test.tsx (which
 * mocks the hook to isolate the "first gesture" wiring), this uses the REAL
 * hook so a regression in either GameBoard's usage or the hook's own
 * ownership tracking (lib/use-fullscreen.test.ts) would show up here too.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

function seat(n: number, name: string): GamePlayer {
  return makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 });
}

function makeTestState(players: GamePlayer[]): GameState {
  const state = createGameState({
    id: 'game-fullscreen-exit',
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

// The REAL lib/use-fullscreen.ts — not mocked, unlike GameBoard.fullscreen.test.tsx.
import { GameBoard } from './GameBoard';

function installMatchMedia(matches: boolean) {
  const mql = {
    get matches() {
      return matches;
    },
    media: '(pointer: coarse)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
}

function installFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
}

function fireFullscreenChange() {
  document.dispatchEvent(new Event('fullscreenchange'));
}

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  installMatchMedia(true);
  document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  installFullscreenElement(null);
});

describe('the board exits fullscreen when it goes away', () => {
  it('exits fullscreen on unmount, having entered it itself on the first gesture', () => {
    const { unmount } = render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob')])}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    fireEvent.pointerDown(screen.getAllByLabelText('+1 life')[0], { pointerId: 1 });
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);

    // The browser confirms the transition asynchronously.
    installFullscreenElement(document.documentElement);
    fireFullscreenChange();

    unmount();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('leaves a fullscreen entered some other way alone on unmount', () => {
    // Already fullscreen before the board ever requests it — some other
    // feature, or the user's own gesture.
    installFullscreenElement(document.documentElement);
    fireFullscreenChange();

    const { unmount } = render(
      <GameBoard
        game={makeTestState([seat(0, 'Alice'), seat(1, 'Bob')])}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    // The board still gets its own first-gesture request in (harmless no-op:
    // `enter()` bails immediately because `document.fullscreenElement` is
    // already set), so this never becomes "the board's".
    fireEvent.pointerDown(screen.getAllByLabelText('+1 life')[0], { pointerId: 1 });
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();

    unmount();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });
});
