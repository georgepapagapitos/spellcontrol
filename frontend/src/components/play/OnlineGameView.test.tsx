// @vitest-environment happy-dom
/**
 * OnlineGameView (T99) — the per-device online surface that replaced
 * GameBoard for online games. Mock harness mirrors GameBoard's own test
 * suites (haptics stubbed so no real Capacitor/vibration path runs); the
 * store mocks follow PlayPage.board-door.test.tsx's simple selector style
 * since this component reads `usePlayStore`/`useAuth` directly rather than
 * taking them as props.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

const dispatchOnline = vi.fn(async () => {});

vi.mock('../../store/play', () => ({
  usePlayStore: <T,>(selector: (s: { dispatchOnline: typeof dispatchOnline }) => T): T =>
    selector({ dispatchOnline }),
}));

const mockAuthUserId: { current: string | null } = { current: 'user_1' };
vi.mock('../../store/auth', () => ({
  useAuth: <T,>(selector: (s: { user: { id: string } | null }) => T): T =>
    selector({ user: mockAuthUserId.current ? { id: mockAuthUserId.current } : null }),
}));

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));

import { OnlineGameView } from './OnlineGameView';

function makeTestPlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({
      id: overrides.id ?? 'p',
      userId: 'user_x',
      seat: 0,
      name: 'X',
      startingLife: 40,
    }),
    ...overrides,
  };
}

function makeTestGame(
  players: GamePlayer[],
  opts: {
    status?: GameState['status'];
    winnerSeat?: number | null;
    activeSeat?: number | null;
    commanderDamageEnabled?: boolean;
    poisonEnabled?: boolean;
  } = {}
): GameState {
  const state = createGameState({
    id: 'game-test',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'user_1',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: opts.commanderDamageEnabled ?? true,
    poisonEnabled: opts.poisonEnabled ?? true,
    players,
  });
  return {
    ...state,
    status: opts.status ?? 'active',
    winnerSeat: opts.winnerSeat ?? null,
    activeSeat: opts.activeSeat ?? null,
  };
}

beforeEach(() => {
  dispatchOnline.mockClear();
  mockAuthUserId.current = 'user_1';
});

/** The life ± controls carry the shared `useTapAndHold` gesture (pointer
 *  events, not click) — mirrors how GameBoard's own tests fire a plain tap:
 *  pointerDown immediately followed by pointerUp at the same point, well
 *  under the hold dwell so it resolves as a single tap. */
let nextPointerId = 1;
function tap(el: HTMLElement) {
  const pointerId = nextPointerId++;
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10, pointerId });
}

describe('Your panel', () => {
  it('dispatches only your own seat on a life tap', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
    ]);
    render(<OnlineGameView game={game} />);

    const you = screen.getByRole('region', { name: 'Your seat' });
    tap(within(you).getByRole('button', { name: '+1 life' }));

    expect(dispatchOnline).toHaveBeenCalledWith({
      type: 'life',
      seat: 0,
      delta: 1,
      actorSeat: 0,
    });
  });
});

describe('Opponent tiles', () => {
  it('render no life controls for a real user seat', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
    ]);
    render(<OnlineGameView game={game} />);

    const opponents = screen.getByRole('list', { name: 'Opponents' });
    const bobTile = within(opponents).getByText('Bob').closest('li')!;
    expect(within(bobTile).queryByRole('button', { name: '+1 life' })).toBeNull();
    expect(within(bobTile).queryByRole('button', { name: '-1 life' })).toBeNull();
  });

  it('render editable life controls for a guest seat', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: null, seat: 1, name: 'Guest' }),
    ]);
    render(<OnlineGameView game={game} />);

    const opponents = screen.getByRole('list', { name: 'Opponents' });
    // "Guest" appears twice (seat name + the guest badge) — scope to the tile.
    const guestTile = within(opponents).getAllByText('Guest')[0].closest('li')!;
    const plus = within(guestTile).getByRole('button', { name: '+1 life' });
    tap(plus);

    expect(dispatchOnline).toHaveBeenCalledWith({
      type: 'life',
      seat: 1,
      delta: 1,
      actorSeat: 1,
    });
    expect(within(guestTile).getByTitle('Guest seat')).toBeTruthy();
  });
});

describe('Commander damage entry', () => {
  it('sends seat = you, fromSeat = attacker', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob', commander: 'Atraxa' }),
    ]);
    render(<OnlineGameView game={game} />);

    const you = screen.getByRole('region', { name: 'Your seat' });
    fireEvent.click(within(you).getByRole('button', { name: /Commander damage/ }));
    fireEvent.click(within(you).getByRole('button', { name: '+1 commander damage from Atraxa' }));

    expect(dispatchOnline).toHaveBeenCalledWith({
      type: 'cmd-dmg',
      seat: 0,
      fromSeat: 1,
      fromPartner: false,
      delta: 1,
      actorSeat: 0,
    });
  });
});

describe('Finished state', () => {
  it('shows the winner and the recap', () => {
    const game = makeTestGame(
      [
        makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
        makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
      ],
      { status: 'finished', winnerSeat: 0 }
    );
    render(<OnlineGameView game={game} onRematch={vi.fn()} onLeave={vi.fn()} />);

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('wins the game')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rematch/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('shows the draw variant when winnerSeat is null', () => {
    const game = makeTestGame(
      [
        makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
        makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
      ],
      { status: 'finished', winnerSeat: null }
    );
    render(<OnlineGameView game={game} />);

    expect(screen.getByText('Game over — no winner')).toBeTruthy();
  });
});

describe('Presence + status render states', () => {
  it('flags a disconnected opponent', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob', connected: false }),
    ]);
    render(<OnlineGameView game={game} />);

    const opponents = screen.getByRole('list', { name: 'Opponents' });
    const bobTile = within(opponents).getByText('Bob').closest('li')!;
    expect(within(bobTile).getByText('Offline')).toBeTruthy();
  });

  it('flags an eliminated opponent as Out', () => {
    const game = makeTestGame([
      makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
      makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob', eliminated: true }),
    ]);
    render(<OnlineGameView game={game} />);

    const opponents = screen.getByRole('list', { name: 'Opponents' });
    const bobTile = within(opponents).getByText('Bob').closest('li')!;
    expect(within(bobTile).getByText('Out')).toBeTruthy();
  });

  it('renders a waiting state for a pending (lobby) game', () => {
    const game = makeTestGame(
      [
        makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
        makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
      ],
      { status: 'lobby' }
    );
    render(<OnlineGameView game={game} />);

    expect(screen.getByText('Waiting to start')).toBeTruthy();
    // No active-turn label yet — activeSeat is null until the game starts.
    expect(screen.queryByText(/'s turn/)).toBeNull();
  });
});
