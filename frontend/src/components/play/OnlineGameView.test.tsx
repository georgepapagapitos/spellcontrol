// @vitest-environment happy-dom
/**
 * OnlineGameView (T99) — the per-device online surface that replaced
 * GameBoard for online games. Mock harness mirrors GameBoard's own test
 * suites (haptics stubbed so no real Capacitor/vibration path runs); the
 * store mocks follow PlayPage.board-door.test.tsx's simple selector style
 * since this component reads `usePlayStore`/`useAuth` directly rather than
 * taking them as props.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamePhase, GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';
import type { GameRequest } from '../../lib/games-api';

const dispatchOnline = vi.fn(async () => {});
const raiseGameRequest = vi.fn();
const cancelGameRequest = vi.fn();
let mockOnlineRequests: Record<number, GameRequest> = {};

vi.mock('../../store/play', () => ({
  usePlayStore: <T,>(
    selector: (s: {
      dispatchOnline: typeof dispatchOnline;
      onlineRequests: Record<number, GameRequest>;
      raiseGameRequest: typeof raiseGameRequest;
      cancelGameRequest: typeof cancelGameRequest;
    }) => T
  ): T =>
    selector({
      dispatchOnline,
      onlineRequests: mockOnlineRequests,
      raiseGameRequest,
      cancelGameRequest,
    }),
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
    phase?: GamePhase;
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
    ...(opts.phase !== undefined ? { phase: opts.phase } : {}),
  };
}

function makeRequest(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'req_1',
    code: 'ABCD',
    kind: 'hold',
    payload: { summary: '' },
    requesterSeat: 1,
    approvals: {},
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 90_000,
    ...overrides,
  };
}

beforeEach(() => {
  dispatchOnline.mockClear();
  raiseGameRequest.mockReset();
  cancelGameRequest.mockReset();
  mockOnlineRequests = {};
  mockAuthUserId.current = 'user_1';
});

afterEach(() => {
  vi.useRealTimers();
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

describe('Phase clock (T101)', () => {
  const twoPlayers = () => [
    makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
    makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
  ];

  it('shows the start affordance only for the active seat’s own owner', () => {
    const game = makeTestGame(twoPlayers(), { activeSeat: 0 });
    render(<OnlineGameView game={game} />);
    expect(screen.getByRole('button', { name: 'Start the phase clock' })).toBeTruthy();
  });

  it('renders nothing phase-related when phase is absent and the viewer is not the active seat', () => {
    const game = makeTestGame(twoPlayers(), { activeSeat: 1 });
    render(<OnlineGameView game={game} />);
    expect(screen.queryByRole('button', { name: 'Start the phase clock' })).toBeNull();
    expect(screen.queryByLabelText(/^Phase:/)).toBeNull();
  });

  it('renders the phase chip for every seat once the clock is running', () => {
    const game = makeTestGame(twoPlayers(), { activeSeat: 1, phase: 'combat' });
    render(<OnlineGameView game={game} />);
    expect(screen.getByLabelText('Phase: Combat')).toBeTruthy();
    // Not the active seat's own device — display only, not a tap target.
    expect(screen.queryByRole('button', { name: /^Phase:/ })).toBeNull();
  });

  it('advance dispatches the next phase and only renders for the active owner', () => {
    const game = makeTestGame(twoPlayers(), { activeSeat: 0, phase: 'beginning' });
    render(<OnlineGameView game={game} />);
    const advance = screen.getByRole('button', { name: 'Phase: Beginning. Tap to advance.' });
    fireEvent.click(advance);
    expect(dispatchOnline).toHaveBeenCalledWith({ type: 'phase', phase: 'main1', actorSeat: 0 });
  });

  it('disables the advance affordance at the end phase — turn-passing resets it, not another tap', () => {
    const game = makeTestGame(twoPlayers(), { activeSeat: 0, phase: 'end' });
    render(<OnlineGameView game={game} />);
    expect(screen.getByRole('button', { name: 'Phase: End' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Hold (T101)', () => {
  const twoPlayers = () => [
    makeTestPlayer({ id: 'p0', userId: 'user_1', seat: 0, name: 'Alice' }),
    makeTestPlayer({ id: 'p1', userId: 'user_2', seat: 1, name: 'Bob' }),
  ];

  it('raises a hold and flips to the release control', async () => {
    const pendingHold = makeRequest({ id: 'req_hold', kind: 'hold', requesterSeat: 0 });
    raiseGameRequest.mockImplementation(async () => {
      mockOnlineRequests = { 0: pendingHold };
      return pendingHold;
    });
    const game = makeTestGame(twoPlayers());
    const { rerender } = render(<OnlineGameView game={game} />);

    const you = screen.getByRole('region', { name: 'Your seat' });
    fireEvent.click(within(you).getByRole('button', { name: 'Hold' }));
    expect(raiseGameRequest).toHaveBeenCalledWith('hold', { summary: '' });

    await act(() => Promise.resolve());
    rerender(<OnlineGameView game={game} />);

    expect(
      within(screen.getByRole('region', { name: 'Your seat' })).getByRole('button', {
        name: 'Release hold',
      })
    ).toBeTruthy();
  });

  it('surfaces the already-pending 409 inline', async () => {
    raiseGameRequest.mockRejectedValue(new Error('A request is already pending for this seat.'));
    const game = makeTestGame(twoPlayers());
    render(<OnlineGameView game={game} />);

    const you = screen.getByRole('region', { name: 'Your seat' });
    fireEvent.click(within(you).getByRole('button', { name: 'Hold' }));

    const alert = await within(you).findByRole('alert');
    expect(alert.textContent).toBe('A request is already pending for this seat.');
  });

  it('renders another seat’s hold as a banner with no release control', () => {
    mockOnlineRequests = { 1: makeRequest({ id: 'req_bob', requesterSeat: 1 }) };
    const game = makeTestGame(twoPlayers());
    render(<OnlineGameView game={game} />);

    const banner = screen.getByText(/holds — responding/).closest('div')!;
    expect(within(banner).getByText('Bob')).toBeTruthy();
    expect(within(banner).queryByRole('button')).toBeNull();
  });

  it('self-dismisses the banner at expiresAt, with no server frame ever arriving', () => {
    vi.useFakeTimers();
    mockOnlineRequests = {
      1: makeRequest({ id: 'req_bob', requesterSeat: 1, expiresAt: Date.now() + 1000 }),
    };
    const game = makeTestGame(twoPlayers());
    render(<OnlineGameView game={game} />);
    expect(screen.getByText(/holds — responding/)).toBeTruthy();

    // 1000ms to the deadline + the 2000ms grace window.
    act(() => {
      vi.advanceTimersByTime(3001);
    });

    expect(screen.queryByText(/holds — responding/)).toBeNull();
  });
});
