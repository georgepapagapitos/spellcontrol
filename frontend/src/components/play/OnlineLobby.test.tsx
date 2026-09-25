// @vitest-environment happy-dom
/**
 * The seated pre-start lobby. The props are all explicit (unlike
 * OnlineGameView, which reads the stores itself), so the only mocks here are
 * the art resolver — a network path — and the router, for the board link.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GamePlayer, GameState } from '../../lib/game-state';
import type { Deck } from '../../store/decks';
import { applyAction, createGameState, makePlayer } from '../../lib/game-state';
import { resolveHordeSettings, HORDE_CATALOG } from '@/lib/horde';
import { HORDE_BAN_LIST } from '@/lib/horde/ban-list';

vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

import { OnlineLobby } from './OnlineLobby';
import { levelSummary } from './horde/HordeSetupFields';

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

function hordeTable(count = 2): GameState {
  return createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u0',
    format: 'horde',
    startingLife: 40,
    commanderDamageEnabled: false,
    poisonEnabled: false,
    players: Array.from({ length: count }, (_, i) => seat(i)),
    ts: 1000,
  });
}

function renderLobby(game: GameState, userId = 'u0', dispatch = vi.fn(), decks: Deck[] = []) {
  const mySeat = game.players.find((p) => p.userId === userId)!;
  render(
    <MemoryRouter>
      <OnlineLobby
        game={game}
        decks={decks}
        userId={userId}
        mySeat={mySeat}
        dispatch={dispatch}
        onLeave={vi.fn()}
      />
    </MemoryRouter>
  );
  return dispatch;
}

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'My Deck',
    cards: [],
    updatedAt: 0,
    ...over,
  } as unknown as Deck;
}

describe('OnlineLobby — seat bracket carries the estimate (2026-09-24 ruling)', () => {
  it('shows "Bracket N · est. M" for your own seat when a stated bracket differs from the estimate', () => {
    const game = createGameState({
      id: 'g1',
      code: 'ABCD',
      mode: 'online',
      hostUserId: 'u0',
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [seat(0, { deckId: 'deck-1' }), seat(1)],
      ts: 1000,
    });
    renderLobby(game, 'u0', vi.fn(), [
      deck({ bracketOverride: 2, bracketEstimation: { bracket: 4 } as Deck['bracketEstimation'] }),
    ]);
    expect(screen.getByText('Bracket 2 · est. 4')).toBeTruthy();
  });

  it('shows only the stated bracket when it matches the estimate', () => {
    const game = createGameState({
      id: 'g1',
      code: 'ABCD',
      mode: 'online',
      hostUserId: 'u0',
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [seat(0, { deckId: 'deck-1' }), seat(1)],
      ts: 1000,
    });
    renderLobby(game, 'u0', vi.fn(), [
      deck({ bracketOverride: 3, bracketEstimation: { bracket: 3 } as Deck['bracketEstimation'] }),
    ]);
    expect(screen.getByText('Bracket 3')).toBeTruthy();
    expect(screen.queryByText(/est\./)).toBeNull();
  });
});

describe('OnlineLobby', () => {
  it('titles the lobby with the format when the table has no name', () => {
    renderLobby(table());
    expect(screen.getByRole('heading', { name: 'Commander table' })).toBeTruthy();
  });

  it('titles the lobby with the table name once the host sets one', () => {
    renderLobby({ ...table(), name: 'Bracket 3 chill' });
    expect(screen.getByRole('heading', { name: 'Bracket 3 chill' })).toBeTruthy();
  });

  it('renders one card per seated player and pads the pod out with open seats', () => {
    renderLobby(table(2));
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats).toHaveLength(4);
    expect(screen.getByText('P0')).toBeTruthy();
    expect(screen.getAllByText('Open seat')).toHaveLength(2);
  });

  it('renders all 10 seats for a full table, not clamped to the old 8-seat cap', () => {
    renderLobby(table(10));
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats).toHaveLength(10);
    expect(screen.getByText('P9')).toBeTruthy();
    expect(screen.queryAllByText('Open seat')).toHaveLength(0);
  });

  it('marks the viewer’s own seat and the host', () => {
    renderLobby(table(2), 'u1');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats[1].className).toContain('is-me');
    expect(seats[0].className).not.toContain('is-me');
    // The crown is the host tell, and it is labelled, not colour-only.
    expect(within(seats[0]).getByLabelText('Host')).toBeTruthy();
  });

  it('shows a seated bracket computed on the OWNER’s device, for any seat (E370)', () => {
    const game = table(2);
    game.players[1] = seat(1, { bracket: 4 });
    renderLobby(game, 'u0');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    // u0 is viewing; seat 1 (someone else's deck) still shows the bracket
    // that seat's own device published — no local recompute required.
    expect(within(seats[1]).getByText('Bracket 4')).toBeTruthy();
    expect(within(seats[0]).queryByText(/^Bracket /)).toBeNull();
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

  // The warning goes; the space it occupied does not. Emptying the slot used
  // to pull Start game sideways under the host's cursor at the exact moment
  // they reached for it.
  it('keeps the slot when the warning goes, so Start game does not move', () => {
    let game = applyAction(table(2), { type: 'set-ready', actorSeat: 0, ready: true });
    game = applyAction(game, { type: 'set-ready', actorSeat: 1, ready: true });
    renderLobby(game, 'u0');
    expect(document.querySelector('.lobby-ready-slot')).toBeTruthy();
    expect(screen.queryByText('2 of 2 ready')).toBeNull();
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

  it('the join code has no dismiss control and stays visible for the whole lobby', () => {
    renderLobby(table());
    expect(screen.getByText('ABCD')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /hide join code/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^dismiss/i })).toBeNull();
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

describe('table settings the pod decides together', () => {
  it('the host picks the mulligan rule; everyone else reads it', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('button', { name: /Mulligan/ }));
    fireEvent.click(screen.getByRole('option', { name: 'London' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { mulliganType: 'london' },
    });

    cleanup();
    renderLobby(table(), 'u1');
    expect(screen.getByText('Commander (first is free)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mulligan/ })).toBeNull();
  });

  it('starting player is a real choice, and Random means nobody yet', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('button', { name: /Starting player/ }));
    fireEvent.click(screen.getByRole('option', { name: 'P1' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'settings', patch: { startingSeat: 1 } });
  });

  it('the host rolls the first player at Start when the table left it on Random', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    const patches = dispatch.mock.calls
      .map(([a]) => a)
      .filter((a) => a.type === 'settings' && 'startingSeat' in a.patch);
    expect(patches).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'start' });
  });

  it('a table that already named a first player is not re-rolled at Start', () => {
    const decided = { ...table(), startingSeat: 1 };
    const dispatch = renderLobby(decided);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(dispatch.mock.calls.map(([a]) => a).filter((a) => a.type === 'settings')).toHaveLength(
      0
    );
  });

  it('shuffling seats sends every seated id, and only the host is offered it', () => {
    const dispatch = renderLobby(table(3));
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    const [action] = dispatch.mock.calls.map(([a]) => a).filter((a) => a.type === 'reseat');
    expect([...action.order].sort()).toEqual(['u0', 'u1', 'u2']);

    cleanup();
    renderLobby(table(3), 'u1');
    expect(screen.queryByRole('button', { name: 'Shuffle' })).toBeNull();
  });

  it('the turn timer is a table rule, off by default', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('switch', { name: /Turn timer/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { turnTimerEnabled: true },
    });
  });

  it('the commander damage toggle dispatches its settings patch', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('switch', { name: /Commander damage/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { commanderDamageEnabled: false },
    });
  });

  it('the poison counters toggle dispatches its settings patch', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('switch', { name: /Poison counters/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { poisonEnabled: true },
    });
  });
});

describe('the deck picker', () => {
  const deck = (id: string, name: string) => ({ id, name, cards: [] }) as unknown as Deck;

  // The randomizer moved inside the picker with the starter catalog (it can
  // now roll a precon, which a bar button could never see) — see
  // DeckPickerDialog.test.tsx. What the bar still owns is opening it.
  it('seats the deck you pick', () => {
    const dispatch = renderLobby(table(), 'u0', vi.fn(), [deck('d1', 'A'), deck('d2', 'B')]);
    fireEvent.click(screen.getByRole('button', { name: 'Deck' }));
    fireEvent.click(screen.getByRole('button', { name: /^B/ }));
    const [action] = dispatch.mock.calls.map(([a]) => a).filter((a) => a.type === 'update-player');
    expect(action.patch).toMatchObject({ deckId: 'd2', deckName: 'B' });
  });

  // A starter deck is not in the decks store, so the trigger's label comes off
  // the seat and the board link goes to the route that resolves the product.
  it('names a seated starter deck and opens its own board route', () => {
    const game = table();
    game.players[0] = seat(0, { deckId: 'starter:precon.json', deckName: 'Squirreled Away' });
    renderLobby(game, 'u0', vi.fn(), [deck('d1', 'A')]);
    expect(screen.getByRole('button', { name: 'Deck' }).textContent).toContain('Squirreled Away');
    expect(screen.getByRole('link', { name: 'Open board' }).getAttribute('href')).toBe(
      '/decks/starters/precon.json/playtest'
    );
  });
});

describe('watchers and the voice link', () => {
  // The ChoiceList radio's accessible name is its label plus its hint glued
  // together — match just the label, at the start.
  const byLabel = (name: string) => new RegExp(`^${name}`);

  it('offers Public, Friends and Private, in that order, with accurate hints', () => {
    renderLobby(table(2), 'u0');
    const radios = screen.getAllByRole('radio', { name: /^(Public|Friends|Private)/ });
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['public', 'friends', 'private']);
    expect(screen.getByText('Listed in the room browser. Anyone can watch.')).toBeTruthy();
    expect(screen.getByText('Listed for your friends. They can watch.')).toBeTruthy();
    expect(screen.getByText('Only people with the code.')).toBeTruthy();
  });

  it('lets the host open the table to watchers', () => {
    const dispatch = renderLobby(table(2), 'u0');
    fireEvent.click(screen.getByRole('radio', { name: byLabel('Public') }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { visibility: 'public' },
    });
  });

  it('lets the host open the table to friends', () => {
    const dispatch = renderLobby(table(2), 'u0');
    fireEvent.click(screen.getByRole('radio', { name: byLabel('Friends') }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { visibility: 'friends' },
    });
  });

  it('tells everyone else where the table stands without letting them change it', () => {
    renderLobby(table(2), 'u1');
    expect(screen.queryByRole('radio', { name: byLabel('Public') })).toBe(null);
    expect(screen.getByText('Private')).toBeTruthy();
  });

  it('reads a friends-visibility table as Friends, not Private', () => {
    const game = table(2);
    game.visibility = 'friends';
    renderLobby(game, 'u1');
    expect(screen.getByText('Friends')).toBeTruthy();
    expect(screen.queryByText('Private')).toBeNull();
  });

  it('saves a voice link on Enter', () => {
    const dispatch = renderLobby(table(2), 'u0');
    const field = screen.getByLabelText('Voice link');
    fireEvent.change(field, { target: { value: 'https://discord.gg/example' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { voiceUrl: 'https://discord.gg/example' },
    });
  });

  it('refuses a link that could run code, before the round trip', () => {
    const dispatch = renderLobby(table(2), 'u0');
    const field = screen.getByLabelText('Voice link');
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.blur(field);
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('https');
  });

  it('gives everyone else the link as something to open', () => {
    const game = { ...table(2), voiceUrl: 'https://meet.example.com/abc' };
    renderLobby(game, 'u1');
    const link = screen.getByRole('link', { name: 'Join the call' });
    expect(link.getAttribute('href')).toBe('https://meet.example.com/abc');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('Horde (co-op) — format pick', () => {
  it('offers Horde (co-op) among the format options', () => {
    renderLobby(table());
    fireEvent.click(screen.getByRole('button', { name: /Format/ }));
    expect(screen.getByRole('option', { name: 'Horde (co-op)' })).toBeTruthy();
  });

  it('picking Horde turns commander damage and poison off, as one settings patch', () => {
    const dispatch = renderLobby(table());
    fireEvent.click(screen.getByRole('button', { name: /Format/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Horde (co-op)' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'settings',
      patch: { format: 'horde', commanderDamageEnabled: false, poisonEnabled: false },
    });
  });
});

describe('Horde (co-op) lobby — the rail', () => {
  it('replaces Starting life with Shared life, and drops Commander damage / Poison / Starting player, for the host', () => {
    renderLobby(hordeTable(2), 'u0');
    expect(screen.getByText('Shared life')).toBeTruthy();
    expect(screen.queryByText('Starting life')).toBeNull();
    expect(screen.queryByText('Commander damage')).toBeNull();
    expect(screen.queryByText('Poison counters')).toBeNull();
    expect(screen.queryByText('Starting player')).toBeNull();
    // Mulligan, Turn timer, Visibility and Voice link all stay.
    expect(screen.getByText('Mulligan')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Turn timer/ })).toBeTruthy();
    expect(screen.getByText('Visibility')).toBeTruthy();
    expect(screen.getByLabelText('Voice link')).toBeTruthy();
  });

  it('same rows for a non-host viewer', () => {
    renderLobby(hordeTable(2), 'u1');
    expect(screen.getByText('Shared life')).toBeTruthy();
    expect(screen.queryByText('Commander damage')).toBeNull();
    expect(screen.queryByText('Poison counters')).toBeNull();
    expect(screen.queryByText('Starting player')).toBeNull();
    expect(screen.getByText('Turn timer')).toBeTruthy();
  });
});

describe('Horde (co-op) lobby — seats capped at 4', () => {
  it('never shows a 5th slot, even padded out from fewer seated', () => {
    renderLobby(hordeTable(2), 'u0');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats).toHaveLength(4);
  });

  it('never shows a 5th slot even if the table somehow carries a 5th seat', () => {
    const game = hordeTable(2);
    game.players.push(seat(2), seat(3), seat(4));
    renderLobby(game, 'u0');
    const seats = within(screen.getByRole('list', { name: 'Seats' })).getAllByRole('listitem');
    expect(seats).toHaveLength(4);
    expect(screen.queryByText('P4')).toBeNull();
  });
});

describe('Horde (co-op) lobby — the pick, synced from table state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the host sees the real horde picker, not a read-only view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLobby(hordeTable(2), 'u0');
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getByText(HORDE_CATALOG[0].name)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeTruthy();
    expect(screen.getByText('Customise')).toBeTruthy();
  });

  // Real timers throughout: the deck is a genuine dynamic `import()` (no
  // mock), so mixing it with fake timers is unreliable — these wait on the
  // real 300ms debounce and the real (near-instant) import settling.
  it('debounces a pick change, then publishes it as horde-setup', async () => {
    const dispatch = renderLobby(hordeTable(2), 'u0');
    // Let the initial deck load (and its own first publish) settle.
    await waitFor(() => expect(dispatch).toHaveBeenCalled(), { timeout: 2000 });
    dispatch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${HORDE_CATALOG[1].name}`) }));
    // Not yet — the publish is debounced.
    expect(dispatch).not.toHaveBeenCalled();

    await waitFor(
      () =>
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'horde-setup',
            hordeId: HORDE_CATALOG[1].id,
            level: 'standard',
            settings: resolveHordeSettings('standard', 2, {}),
          })
        ),
      { timeout: 2000 }
    );
  });

  it('re-publishes when the seated count changes', async () => {
    const dispatch = vi.fn();
    const game = hordeTable(2);
    const { rerender } = render(
      <MemoryRouter>
        <OnlineLobby
          game={game}
          decks={[]}
          userId="u0"
          mySeat={game.players[0]}
          dispatch={dispatch}
          onLeave={vi.fn()}
        />
      </MemoryRouter>
    );
    await waitFor(() => expect(dispatch).toHaveBeenCalled(), { timeout: 2000 });
    dispatch.mockClear();

    const grown = { ...game, players: [...game.players, seat(2)] };
    rerender(
      <MemoryRouter>
        <OnlineLobby
          game={grown}
          decks={[]}
          userId="u0"
          mySeat={grown.players[0]}
          dispatch={dispatch}
          onLeave={vi.fn()}
        />
      </MemoryRouter>
    );
    await waitFor(
      () =>
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'horde-setup',
            settings: resolveHordeSettings('standard', 3, {}),
          })
        ),
      { timeout: 2000 }
    );
  });

  it("a joiner reads the host's published pick and the table's real numbers, not a form of their own", () => {
    const settings = resolveHordeSettings('standard', 2);
    const game = applyAction(hordeTable(2), {
      type: 'horde-setup',
      hordeId: HORDE_CATALOG[0].id,
      level: 'standard',
      settings,
      seed: 1,
      deckRev: 'rev-1',
    });
    renderLobby(game, 'u1');
    expect(screen.getByText('The host picks the horde.')).toBeTruthy();
    expect(screen.getByText(HORDE_CATALOG[0].name)).toBeTruthy();
    expect(screen.getByText(levelSummary(settings))).toBeTruthy();
    expect(screen.queryByText('Customise')).toBeNull();
    expect(
      screen.queryByRole('button', { name: new RegExp(`^${HORDE_CATALOG[0].name}`) })
    ).toBeNull();
  });

  it('a joiner sees a loading note before the host has published anything', () => {
    renderLobby(hordeTable(2), 'u1');
    expect(screen.getByText('Setting up the horde…')).toBeTruthy();
  });

  it('Start batches horde-setup (with the seated-count settings and a deckRev) before start', async () => {
    const dispatch = renderLobby(hordeTable(2), 'u0');
    // The button reads "Loading the horde…" and stays disabled until the
    // deck has actually resolved.
    const startBtn = await screen.findByRole('button', { name: 'Start game' }, { timeout: 2000 });
    dispatch.mockClear();

    fireEvent.click(startBtn);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [batch] = dispatch.mock.calls[0];
    expect(Array.isArray(batch)).toBe(true);
    expect(batch[0]).toMatchObject({
      type: 'horde-setup',
      hordeId: HORDE_CATALOG[0].id,
      level: 'standard',
      settings: resolveHordeSettings('standard', 2, {}),
    });
    expect(typeof batch[0].deckRev).toBe('string');
    expect(batch[0].deckRev.length).toBeGreaterThan(0);
    expect(batch[1]).toEqual({ type: 'start' });
  });
});

describe('Horde (co-op) lobby — own-seat-only ban warning', () => {
  it('warns about a banned card in the viewer’s own seat, and never doubles up for another seat', () => {
    const bannedName = HORDE_BAN_LIST[0];
    const game = hordeTable(2);
    game.players[0] = seat(0, { deckId: 'deck-mine' });
    game.players[1] = seat(1, { deckId: 'deck-theirs' });
    renderLobby(game, 'u0', vi.fn(), [
      deck({
        id: 'deck-mine',
        cards: [{ card: { name: bannedName } }] as unknown as Deck['cards'],
      }),
      deck({
        id: 'deck-theirs',
        cards: [{ card: { name: bannedName } }] as unknown as Deck['cards'],
      }),
    ]);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(`P0: ${bannedName} is on the Horde ban list.`);
    expect(status.textContent).not.toContain('P1:');
  });

  it('shows nothing when the viewer’s own deck is clean', () => {
    const game = hordeTable(2);
    game.players[0] = seat(0, { deckId: 'deck-mine' });
    renderLobby(game, 'u0', vi.fn(), [deck({ id: 'deck-mine', cards: [] })]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
