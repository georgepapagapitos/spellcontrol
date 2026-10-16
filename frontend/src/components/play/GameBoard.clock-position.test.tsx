// @vitest-environment happy-dom
/**
 * Where the table clock lives (2026-10-16 ruling). The game total is shared,
 * so it stays in one fixed place; the turn control is personal, so on the
 * `seat` position it follows the turn and faces whoever holds it.
 *
 *  - seat:   no strip. The hub carries the game time; the ACTIVE seat's panel
 *            carries the "End turn" bar; Pause/Start live in the hub's dock.
 *  - hub:    the same hub time, with a compact chip instead of the bar.
 *  - bottom: the edge strip, unchanged. top: the same strip, turned to face
 *            the far side.
 *
 * Mirrors the mock harness in GameBoard.turn.test.tsx; the store mock reads a
 * mutable object so each test picks its position and switches.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameAction, GamePlayer, GameState } from '@spellcontrol/game-core';
import { createGameState, makePlayer } from '@spellcontrol/game-core';

const prefs = vi.hoisted(() => ({
  clockPosition: 'seat' as string,
  gameTimerEnabled: true,
  turnTrackerEnabled: true,
}));

function seat(n: number, name: string): GamePlayer {
  return makePlayer({ id: `p${n}`, userId: null, seat: n, name, startingLife: 40 });
}

function makeTestState(over: Partial<GameState> = {}): GameState {
  const state = createGameState({
    id: 'game-clock-position',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: true,
    players: [seat(0, 'Alice'), seat(1, 'Bob'), seat(2, 'Cy')],
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
      ...prefs,
      setGameTimerEnabled: vi.fn(),
      setTurnTrackerEnabled: vi.fn(),
      setClockPosition: vi.fn(),
    });
  usePlayStore.getState = getState;
  return { usePlayStore };
});

vi.mock('@/lib/util/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));
vi.mock('@/lib/util/use-wake-lock', () => ({ useWakeLock: vi.fn() }));
vi.mock('@/lib/play/undo-stack', () => ({
  capture: vi.fn(),
  clearUndo: vi.fn(),
  peekLabel: vi.fn(() => null),
  popRestore: vi.fn(() => []),
  runSuppressed: vi.fn((fn: () => void) => fn()),
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { GameBoard } from './GameBoard';

const bars = () => [...document.querySelectorAll('.player-panel .pp-turn-bar')];
const barSeat = () => bars().map((b) => b.closest('.player-panel')?.getAttribute('data-seat'));
const hub = () => screen.getByRole('button', { name: /^Game menu/ });
// The menu's bottom: the actions row (clock controls) and the dock, in order.
const dock = () =>
  [...document.querySelectorAll('.board-hub-action, .board-hub-dock-item')].map(
    (e) => e.textContent
  );
const actions = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls.map(([a]) => a as GameAction);

beforeEach(() => {
  localStorage.setItem('sc-board-gestures-seen', '1');
  prefs.clockPosition = 'seat';
  prefs.gameTimerEnabled = true;
  prefs.turnTrackerEnabled = true;
});
afterEach(cleanup);

describe('clock position: seat (the default)', () => {
  it('draws no strip, and puts the End turn bar on the active seat only', () => {
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-clock-strip')).toBeNull();
    expect(barSeat()).toEqual(['1']);
    expect(bars()[0].classList.contains('is-bar')).toBe(true);
    // Inside the seat's panel, so it rotates with the seat.
    expect(bars()[0].closest('.player-panel')).toBeTruthy();
  });

  it('moves to the next seat when the turn passes', () => {
    const { rerender } = render(
      <GameBoard game={makeTestState({ activeSeat: 0 })} dispatch={vi.fn()} canControlAll />
    );
    expect(barSeat()).toEqual(['0']);
    rerender(
      <GameBoard game={makeTestState({ activeSeat: 2 })} dispatch={vi.fn()} canControlAll />
    );
    expect(barSeat()).toEqual(['2']);
  });

  it('ends the turn through the same pass-turn the strip uses', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={dispatch} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: /^End Bob's turn/ }));
    expect(actions(dispatch).filter((a) => a.type === 'pass-turn')).toEqual([
      { type: 'pass-turn', actorSeat: 1 },
    ]);
  });

  it('shows no bar before any seat holds the turn, nor once the game is over', () => {
    const { unmount } = render(
      <GameBoard game={makeTestState()} dispatch={vi.fn()} canControlAll />
    );
    expect(bars()).toHaveLength(0);
    unmount();
    render(
      <GameBoard
        game={makeTestState({ activeSeat: 1, status: 'finished', endedAt: Date.now() })}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    expect(bars()).toHaveLength(0);
  });

  it('shows no bar on an eliminated seat, nor while commander damage is being logged', () => {
    const game = makeTestState({ activeSeat: 1 });
    game.players[1] = { ...game.players[1], eliminated: true };
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    expect(bars()).toHaveLength(0);
  });

  it('is a readout, not a button, for a viewer who cannot edit', () => {
    render(
      <GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll={false} />
    );
    expect(bars()).toHaveLength(1);
    expect(bars()[0].tagName).not.toBe('BUTTON');
    expect(screen.queryByRole('button', { name: /^End Bob's turn/ })).toBeNull();
  });

  it('hides the bar when the turn tracker is off', () => {
    prefs.turnTrackerEnabled = false;
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    expect(bars()).toHaveLength(0);
  });

  it('puts the game time in the hub, and says so in its name', () => {
    render(<GameBoard game={makeTestState({ activeSeat: 0 })} dispatch={vi.fn()} canControlAll />);
    expect(hub().classList.contains('has-time')).toBe(true);
    expect(hub().getAttribute('aria-label')).toMatch(/^Game menu\. Game \d+:\d\d$/);
    expect(hub().querySelector('.game-board-menu-time-value')?.textContent).toMatch(/^\d+:\d\d$/);
  });

  it('keeps the hub a plain round menu button when the game timer is off', () => {
    prefs.gameTimerEnabled = false;
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    expect(hub().classList.contains('has-time')).toBe(false);
    expect(hub().getAttribute('aria-label')).toBe('Game menu');
    // The bar is the turn tracker's, so it stays.
    expect(barSeat()).toEqual(['1']);
  });

  it('draws nothing at all with both switches off', () => {
    prefs.gameTimerEnabled = false;
    prefs.turnTrackerEnabled = false;
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    expect(bars()).toHaveLength(0);
    expect(document.querySelector('.game-clock-strip')).toBeNull();
    expect(hub().getAttribute('aria-label')).toBe('Game menu');
  });

  it('freezes the hub time on a finished game and shows no bar', () => {
    const endedAt = Date.now();
    render(
      <GameBoard
        game={makeTestState({ activeSeat: 1, status: 'finished', endedAt })}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    expect(hub().classList.contains('has-time')).toBe(true);
    expect(bars()).toHaveLength(0);
  });

  it('reads waiting before the first turn, and offers Start now', () => {
    const dispatch = vi.fn();
    const game = makeTestState({ startedAt: Date.now(), clockStartedAt: null });
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
    expect(hub().getAttribute('aria-label')).toMatch(/waiting for the first turn/);
    fireEvent.click(hub());
    expect(dock()).toEqual(expect.arrayContaining(['Start now', 'Start turns']));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start now' }));
    expect(actions(dispatch)).toContainEqual({ type: 'clock-start' });
  });

  it('moves Pause into the hub menu, and says paused on the hub', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState({ activeSeat: 0 })} dispatch={dispatch} canControlAll />);
    fireEvent.click(hub());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(actions(dispatch)).toContainEqual({ type: 'clock', paused: true, actorSeat: null });
  });

  it('starts the turns from the hub menu, at the recorded first player', () => {
    const dispatch = vi.fn();
    render(
      <GameBoard game={makeTestState({ startingSeat: 2 })} dispatch={dispatch} canControlAll />
    );
    fireEvent.click(hub());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start turns' }));
    expect(actions(dispatch)).toContainEqual({ type: 'pass-turn', actorSeat: null, toSeat: 2 });
  });
});

describe('an unrotated board (desktop, online) keeps the hub off the button', () => {
  const panelOf = (seatNo: number) =>
    document.querySelector(`.player-panel[data-seat="${seatNo}"]`);

  it('puts the bar on the top edge of a seat whose bottom edge is the hub row', () => {
    // Online boards never rotate seats, so seat 0 (top row of 2p-stacked) has
    // the hub on its bottom edge: the bar would sit under it.
    render(
      <GameBoard
        game={makeTestState({ mode: 'online', activeSeat: 0 })}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    expect(panelOf(0)?.classList.contains('has-turn-top')).toBe(true);
    expect(bars()[0].closest('.pp-turn-bar-wrap')?.classList.contains('is-top-edge')).toBe(true);
  });

  it('keeps the bottom edge for a seat the hub does not touch', () => {
    render(
      <GameBoard
        game={makeTestState({ mode: 'online', activeSeat: 2 })}
        dispatch={vi.fn()}
        canControlAll
      />
    );
    expect(panelOf(2)?.classList.contains('has-turn-bottom')).toBe(true);
  });

  it('a rotated local board always keeps the bottom edge, which faces the seat', () => {
    render(<GameBoard game={makeTestState({ activeSeat: 0 })} dispatch={vi.fn()} canControlAll />);
    expect(panelOf(0)?.classList.contains('has-turn-bottom')).toBe(true);
  });
});

describe('clock position: hub', () => {
  it('carries the hub time and a compact chip on the active seat', () => {
    prefs.clockPosition = 'hub';
    render(<GameBoard game={makeTestState({ activeSeat: 2 })} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-clock-strip')).toBeNull();
    expect(hub().classList.contains('has-time')).toBe(true);
    expect(barSeat()).toEqual(['2']);
    expect(bars()[0].classList.contains('is-chip')).toBe(true);
    expect(bars()[0].querySelector('.pp-turn-bar-label')).toBeNull();
  });
});

describe('clock position: bottom and top (the edge strip)', () => {
  it('bottom draws the strip and nothing on the seats or hub', () => {
    prefs.clockPosition = 'bottom';
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    const strip = document.querySelector('.game-clock-strip');
    expect(strip).toBeTruthy();
    expect(strip?.classList.contains('is-top')).toBe(false);
    // After the grid.
    expect(document.querySelector('.game-board-grid')?.compareDocumentPosition(strip as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(bars()).toHaveLength(0);
    expect(hub().classList.contains('has-time')).toBe(false);
  });

  it('top draws the same strip before the grid, turned to face the far side', () => {
    prefs.clockPosition = 'top';
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    const strip = document.querySelector('.game-clock-strip');
    expect(strip?.classList.contains('is-top')).toBe(true);
    expect(document.querySelector('.game-board-grid')?.compareDocumentPosition(strip as Node)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING
    );
    expect(bars()).toHaveLength(0);
    // The strip keeps its own Pass control.
    expect(screen.getByRole('button', { name: /^Pass Bob's turn/ })).toBeTruthy();
  });

  it('keeps clock controls out of the hub dock when the strip has them', () => {
    prefs.clockPosition = 'bottom';
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(hub());
    expect(dock()).toEqual(['History', 'Rules']);
  });

  it('an unknown stored value reads as the default position', () => {
    prefs.clockPosition = 'sideways';
    render(<GameBoard game={makeTestState({ activeSeat: 1 })} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.game-clock-strip')).toBeNull();
    expect(barSeat()).toEqual(['1']);
  });
});
