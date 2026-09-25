// @vitest-environment happy-dom
/**
 * "Keep the board still" (landscape): a phone lying flat that auto-rotates
 * into landscape must not spin the seats — `.game-board-rotator` carries a
 * counter-rotation instead, and every seat's gesture math must compose that
 * board-level rotation with its own seat rotation, or a swipe that used to
 * open a drawer in portrait would silently stop working once the device
 * turns (see `lib/use-board-keep-still.ts` and the STYLE_GUIDE ruling).
 *
 * Harness mirrors GameBoard.gestures.test.tsx.
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
    id: 'game-board-rotation',
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

let mockBoardRotation: 0 | 90 | -90 = 0;
vi.mock('../../lib/use-board-keep-still', () => ({
  useBoardKeepStill: () => mockBoardRotation,
}));

import { GameBoard } from './GameBoard';

/** 3p default: Alice across the top (180°), Bob right (270°), Carol left (90°). */
const pod = () => [seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Carol')];

function zone(seatIndex: number) {
  return screen
    .getAllByLabelText('+1 life')
    .filter((el) => el.classList.contains('player-panel-tapzone'))[seatIndex];
}

/** Drag in SCREEN space. */
function drag(el: Element, dx: number, dy: number) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 200, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 200 + dy, pointerId: 1 });
}

const drawer = (name: string) => screen.queryByRole('dialog', { name: `Seat menu for ${name}` });

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
  mockBoardRotation = 0;
});

describe('.game-board-rotator carries the board rotation as a data attribute', () => {
  it('is unset (no attribute) when the board is not counter-rotated', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    const rotator = document.querySelector('.game-board-rotator');
    expect(rotator?.hasAttribute('data-board-rot')).toBe(false);
  });

  it('reflects a +90 board rotation', () => {
    mockBoardRotation = 90;
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-board-rotator')?.getAttribute('data-board-rot')).toBe(
      '90'
    );
  });

  it('reflects a -90 board rotation', () => {
    mockBoardRotation = -90;
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-board-rotator')?.getAttribute('data-board-rot')).toBe(
      '-90'
    );
  });
});

describe('gesture math composes the board rotation with the seat rotation', () => {
  it('the un-rotated screen gesture that opens a swiped-away-from seat drawer in portrait', () => {
    // Baseline, boardRotation = 0: Alice (180°) — toward her is screen UP,
    // matching GameBoard.gestures.test.tsx exactly.
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    drag(zone(0), 0, -60);
    expect(drawer('Alice')).toBeTruthy();
  });

  it('the SAME screen gesture no longer opens it once the board is counter-rotated', () => {
    // Alice's effective rotation becomes (180 + 90) % 360 = 270 once the
    // board itself is rotated +90° — the old "screen up" swipe now resolves
    // to a mostly-horizontal panel-space delta, which the hook's own
    // SWIPE_AXIS_RATIO gate correctly refuses to treat as a vertical swipe.
    // A stale (uncomposed) rotation would still have opened the drawer here.
    mockBoardRotation = 90;
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    drag(zone(0), 0, -60);
    expect(drawer('Alice')).toBeNull();
  });

  it('the CORRECTLY composed screen gesture opens it instead', () => {
    // Same board rotation (+90): the screen gesture that now maps to
    // "toward Alice" is rotated 90° from the portrait one — screen RIGHT,
    // not screen up. Composing gestureRotation = (180 + 90) % 360 = 270
    // rather than leaving it at the seat's own 180° is what makes this work.
    mockBoardRotation = 90;
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    drag(zone(0), 60, 0);
    expect(drawer('Alice')).toBeTruthy();
  });

  it('composes correctly for a sideways seat too, at the opposite board rotation', () => {
    // Bob (270°) composed with boardRotation = -90 gives (270 - 90) % 360 =
    // 180 — "toward him" becomes screen UP instead of his portrait screen
    // RIGHT (see GameBoard.gestures.test.tsx's uncomposed case) — the same
    // "screen up" a rot-180 seat like Alice uses at boardRotation 0, since
    // 180 is 180 regardless of how a seat/board pair summed to get there.
    mockBoardRotation = -90;
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    drag(zone(1), 60, 0);
    expect(drawer('Bob')).toBeNull();
    drag(zone(1), 0, -60);
    expect(drawer('Bob')).toBeTruthy();
  });
});
