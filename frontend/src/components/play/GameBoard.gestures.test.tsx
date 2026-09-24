// @vitest-environment happy-dom
/**
 * The Lotus model (2026-09-24): a seat is its number and nothing else. What
 * used to be buttons on the seat (⋯, counter chips, the turn chip) is one
 * swipe away in the seat's drawer, and the board teaches that once.
 *
 * Harness mirrors GameBoard.turn.test.tsx.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    id: 'game-gestures',
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

import { GameBoard } from './GameBoard';

/** 3p default: Alice across the top (180°), Bob right (270°), Carol left (90°) — seat order is clockwise from above. */
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
  // Most tests are about the board, not the first-run card.
  localStorage.setItem('sc-board-gestures-seen', '1');
});

describe('the seat drawer', () => {
  it('opens when a seat is swiped toward its player, whichever way they face', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);

    // Alice is across the table (180°): toward her is screen UP.
    drag(zone(0), 0, -60);
    expect(drawer('Alice')).toBeTruthy();
  });

  it('opens on a sideways seat from a sideways swipe, never a screen-vertical one', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);

    // Bob sits on the right long edge (270°): toward him is screen RIGHT.
    drag(zone(1), 0, 60);
    expect(drawer('Bob')).toBeNull();
    drag(zone(1), 60, 0);
    expect(drawer('Bob')).toBeTruthy();
  });

  it('closes from the strip of seat it leaves showing', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Alice: seat menu' }));

    fireEvent.click(screen.getByRole('button', { name: "Close Alice's seat menu" }));
    expect(drawer('Alice')).toBeNull();
  });

  it('holds the counters, the rename and the partner that used to live elsewhere', () => {
    const dispatch = vi.fn();
    render(<GameBoard game={makeTestState(pod())} dispatch={dispatch} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Alice: seat menu' }));
    const d = within(drawer('Alice') as HTMLElement);

    // Poison lives here now (the chip on the seat is gone).
    const plusPoison = d.getByRole('button', { name: '+1 ☠ Poison' });
    fireEvent.pointerDown(plusPoison, { pointerId: 2 });
    fireEvent.pointerUp(plusPoison, { pointerId: 2 });

    fireEvent.change(d.getByLabelText('Name'), { target: { value: '  Ally  ' } });
    fireEvent.click(d.getAllByRole('button', { name: 'Save' })[0]);

    fireEvent.change(d.getByLabelText('Partner commander'), { target: { value: 'Tymna' } });
    fireEvent.click(d.getAllByRole('button', { name: 'Save' })[1]);

    const sent = dispatch.mock.calls.map(([a]) => a as GameAction);
    expect(sent).toContainEqual({ type: 'poison', seat: 0, delta: 1, actorSeat: 0 });
    expect(sent).toContainEqual({ type: 'update-player', seat: 0, patch: { name: 'Ally' } });
    expect(sent).toContainEqual({ type: 'update-player', seat: 0, patch: { partner: 'Tymna' } });
  });

  it('is how an eliminated seat comes back', () => {
    const dispatch = vi.fn();
    const game = makeTestState([seat(0, 'Alice', { eliminated: true }), seat(1, 'Bob')]);
    render(<GameBoard game={game} dispatch={dispatch} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Alice: seat menu' }));

    fireEvent.click(screen.getByRole('button', { name: 'Revive' }));
    expect(dispatch.mock.calls.map(([a]) => a)).toContainEqual({
      type: 'eliminate',
      seat: 0,
      eliminated: false,
    });
  });
});

describe('a seat carries no buttons', () => {
  it('has only its name and ± as controls, and shows non-zero counts as read-only badges', () => {
    const game = makeTestState([
      seat(0, 'Alice', { poison: 3, counters: { Energy: 2, Rad: 0 } }),
      seat(1, 'Bob'),
    ]);
    render(<GameBoard game={game} dispatch={vi.fn()} canControlAll />);
    const alice = document.querySelector('.player-panel[data-seat="0"]') as HTMLElement;

    expect(within(alice).getByRole('img', { name: 'Poison 3' })).toBeTruthy();
    expect(alice.querySelector('.player-panel-counters')?.textContent).toContain('Energy');
    // Zero counts stay off the seat.
    expect(alice.querySelector('.player-panel-counters')?.textContent).not.toContain('Rad');
    const controls = [...alice.querySelectorAll('.player-panel-content button')].map((b) =>
      b.getAttribute('aria-label')
    );
    expect(controls).toEqual(['Alice: seat menu', '-1 life', 'Set life: currently 40', '+1 life']);
  });

  it('shows nothing extra on a fresh seat', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    expect(document.querySelector('.player-panel-counters')).toBeNull();
  });
});

describe('how the board works', () => {
  it('teaches the gestures once per device, then stays out of the way', () => {
    localStorage.removeItem('sc-board-gestures-seen');
    const { unmount } = render(
      <GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />
    );
    const card = screen.getByRole('dialog', { name: 'How the board works' });
    expect(card.textContent).toContain('toward you');
    fireEvent.click(within(card).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: 'How the board works' })).toBeNull();
    unmount();

    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    expect(screen.queryByRole('dialog', { name: 'How the board works' })).toBeNull();
  });

  it('comes back from the game menu', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'How the board works' }));
    expect(screen.getByRole('dialog', { name: 'How the board works' })).toBeTruthy();
  });

  it('comes back from the hub ring directly, via Help', () => {
    render(<GameBoard game={makeTestState(pod())} dispatch={vi.fn()} canControlAll />);
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'How the board works' })).toBeTruthy();
  });
});
