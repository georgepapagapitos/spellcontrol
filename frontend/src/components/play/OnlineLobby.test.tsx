// @vitest-environment happy-dom
/**
 * The seated pre-start lobby. The props are all explicit (unlike
 * OnlineGameView, which reads the stores itself), so the only mocks here are
 * the art resolver — a network path — and the router, for the board link.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { applyAction, createGameState, makePlayer } from '../../lib/game-state';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { OnlineLobby } from './OnlineLobby';

function seat(i: number, overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    ...makePlayer({
      id: `u${i}`,
      userId: `u${i}`,
      seat: i,
      name: `P${i}`,
      startingLife: 40,
      isHost: i === 0,
    }),
    ...overrides,
  };
}

function table(count = 2): GameState {
  return createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: Array.from({ length: count }, (_, i) => seat(i)),
    ts: 1000,
  });
}

function renderLobby(game: GameState, userId = 'u0', dispatch = vi.fn()) {
  const mySeat = game.players.find((p) => p.userId === userId)!;
  render(
    <MemoryRouter>
      <OnlineLobby
        game={game}
        decks={[]}
        userId={userId}
        mySeat={mySeat}
        dispatch={dispatch}
        onLeave={vi.fn()}
      />
    </MemoryRouter>
  );
  return dispatch;
}

describe('OnlineLobby', () => {
  it('renders one card per seated player and pads the pod out with open seats', () => {
    renderLobby(table(2));
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats).toHaveLength(4);
    expect(screen.getByText('P0')).toBeTruthy();
    expect(screen.getAllByText('Open seat')).toHaveLength(2);
  });

  it('marks the viewer’s own seat and the host', () => {
    renderLobby(table(2), 'u1');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats[1].className).toContain('is-me');
    expect(seats[0].className).not.toContain('is-me');
    // The crown is the host tell, and it is labelled, not colour-only.
    expect(within(seats[0]).getByLabelText('Host')).toBeTruthy();
  });

  it('states readiness in words, not only in colour', () => {
    const game = applyAction(table(2), { type: 'set-ready', actorSeat: 0, ready: true });
    renderLobby(game);
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(within(seats[0]).getByText('Ready')).toBeTruthy();
    expect(within(seats[1]).getByText('Choosing a deck')).toBeTruthy();
  });

  it('the ready button dispatches set-ready for the viewer’s own seat only', () => {
    const dispatch = renderLobby(table(2), 'u1');
    fireEvent.click(screen.getByRole('button', { name: "I'm ready" }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-ready', actorSeat: 1, ready: true });
  });

  it('warns the host about the count without blocking Start', () => {
    const game = applyAction(table(3), { type: 'set-ready', actorSeat: 0, ready: true });
    const dispatch = renderLobby(game, 'u0');
    expect(screen.getByText('1 of 3 ready')).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Start game' });
    expect(start.hasAttribute('disabled')).toBe(false);
    fireEvent.click(start);
    expect(dispatch).toHaveBeenCalledWith({ type: 'start' });
  });

  it('drops the warning once everyone is ready', () => {
    let game = applyAction(table(2), { type: 'set-ready', actorSeat: 0, ready: true });
    game = applyAction(game, { type: 'set-ready', actorSeat: 1, ready: true });
    renderLobby(game);
    expect(screen.queryByText('2 of 2 ready')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start game' })).toBeTruthy();
  });

  it('a guest sees read-only settings and who they are waiting for', () => {
    renderLobby(table(2), 'u1');
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
    expect(screen.getByText('Waiting for P0 to start')).toBeTruthy();
    // Host-only controls are absent, the values are not.
    expect(screen.queryByRole('switch', { name: /Commander damage/ })).toBeNull();
    expect(screen.getByText('Commander damage')).toBeTruthy();
  });

  it('chat sends a note from the viewer’s seat and shows system lines as system', () => {
    const game = applyAction(table(2), { type: 'set-ready', actorSeat: 0, ready: true });
    const dispatch = renderLobby(game);
    expect(screen.getByText('P0 is ready')).toBeTruthy();
    const input = screen.getByLabelText('Message the table');
    fireEvent.change(input, { target: { value: '  go whenever  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'note',
      actorSeat: 0,
      message: 'go whenever',
    });
  });
});

// Guest seats: someone at the table with no device. The host names them into
// an open seat; the server already allows add-player for the host and lets
// anyone seated adjust a seat with no account once the game runs.
describe('guest seats', () => {
  it('only the host can seat a guest in an open seat', () => {
    renderLobby(table(2), 'u1');
    expect(screen.queryByRole('button', { name: /Seat a guest/ })).toBeNull();
  });

  it('naming a guest dispatches add-player with no account behind the seat', () => {
    const dispatch = renderLobby(table(2), 'u0');
    fireEvent.click(screen.getByRole('button', { name: 'Seat a guest in seat 3' }));
    const input = screen.getByRole('textbox', { name: "Guest's name" });
    fireEvent.change(input, { target: { value: '  Walk-up   Wally ' } });
    fireEvent.submit(input.closest('form')!);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('add-player');
    expect(action.player).toMatchObject({
      userId: null,
      seat: 2,
      name: 'Walk-up Wally',
      life: 40,
    });
  });

  it('a guest seat says so, counts as ready, and the host can manage or remove it', () => {
    const game = applyAction(table(2), {
      type: 'add-player',
      player: makePlayer({ id: 'g', userId: null, seat: 2, name: 'Wally', startingLife: 40 }),
    });
    const dispatch = renderLobby(game, 'u0');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(within(seats[2]).getByText('Guest')).toBeTruthy();
    expect(within(seats[2]).getByText('Seated by the host')).toBeTruthy();
    // Two account seats not ready, one guest: the guest never holds it up.
    expect(screen.getByText('1 of 3 ready')).toBeTruthy();
    fireEvent.click(within(seats[2]).getByRole('button', { name: 'Remove Wally' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'remove-player', seat: 2 });
  });

  it('a non-host sees the guest but no controls for it', () => {
    const game = applyAction(table(2), {
      type: 'add-player',
      player: makePlayer({ id: 'g', userId: null, seat: 2, name: 'Wally', startingLife: 40 }),
    });
    renderLobby(game, 'u1');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(within(seats[2]).getByText('Guest')).toBeTruthy();
    expect(within(seats[2]).queryByRole('button', { name: 'Remove Wally' })).toBeNull();
  });
});
