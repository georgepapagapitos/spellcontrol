// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayPage } from './PlayPage';
import { usePlayStore } from '../store/play';
import { useAuth } from '../store/auth';
import type { GameRecord } from '../lib/game-state';

// Signed in, the History tab reads the server record and the leaderboard;
// neither is under test here, and an offline read must leave the persisted
// list on screen — which is exactly what a rejection exercises.
vi.mock('../lib/game-results-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/game-results-client')>();
  return {
    ...actual,
    fetchMyResults: vi.fn(() => Promise.reject(new Error('offline'))),
    fetchLeaderboard: vi.fn(() => Promise.reject(new Error('offline'))),
    postLocalResult: vi.fn(),
    deleteGameResult: vi.fn(() => Promise.resolve()),
  };
});

// Signed in, the page also polls game nights; not under test here.
vi.mock('../components/play/GameNights', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/play/GameNights')>();
  return {
    ...actual,
    useGameNights: () => ({ nights: [], loading: false, error: null, refresh: () => {} }),
  };
});

// The people a signed-in table can seat: two friends and one pod.
vi.mock('../lib/friends-client', () => ({
  listFriends: vi.fn(() =>
    Promise.resolve([
      { id: 'u-bob', username: 'bob', displayName: 'Bobby', friendedAt: 1, cardCount: 0 },
      { id: 'u-cal', username: 'cal', displayName: null, friendedAt: 1, cardCount: 0 },
    ])
  ),
}));
vi.mock('../lib/pods-client', () => ({
  listPods: vi.fn(() =>
    Promise.resolve([
      {
        id: 'pod-1',
        name: 'Thursday',
        ownerUserId: 'me',
        ownerUsername: 'georg',
        createdAt: 1,
        myStatus: 'member',
        memberCount: 3,
      },
    ])
  ),
  getPod: vi.fn(() =>
    Promise.resolve({
      id: 'pod-1',
      name: 'Thursday',
      ownerUserId: 'me',
      ownerUsername: 'georg',
      createdAt: 1,
      myStatus: 'member',
      members: [
        { userId: 'u-bob', username: 'bob', status: 'member', joinedAt: 2 },
        { userId: 'me', username: 'georg', status: 'member', joinedAt: 1 },
        { userId: 'u-cal', username: 'cal', status: 'member', joinedAt: 3 },
        { userId: 'u-dan', username: 'dan', status: 'invited', joinedAt: null },
      ],
    })
  ),
}));

function renderPage(initialEntry = '/play') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/play" element={<PlayPage />} />
        <Route path="/play/:section" element={<PlayPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PlayPage tabs', () => {
  it('renders Local/Online/Game nights/History through the shared Tabs primitive', () => {
    const { container } = renderPage('/play/local');
    const tablist = screen.getByRole('tablist', { name: 'Play sections' });
    expect(tablist.classList.contains('sc-tabs')).toBe(true);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Play',
      'Local',
      'Online',
      'Game nights',
      'History',
    ]);
    // No hand-rolled strip left behind.
    expect(container.querySelector('.play-tabs')).toBeNull();
  });

  it('defaults to the Play dashboard with roving tabindex', () => {
    renderPage();
    const play = screen.getByRole('tab', { name: 'Play' });
    expect(play.getAttribute('aria-selected')).toBe('true');
    expect(play.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('tabindex')).toBe('-1');
    // The dashboard's doors are the visible panel, not a form.
    expect(screen.getByRole('button', { name: /Track a table/ })).toBeTruthy();
    expect(screen.queryByText('New local game')).toBeNull();
  });

  it('lands on the board when a local game is on screen, and on the dashboard once minimized', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [
        { name: 'Alice', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'Bob', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    const { unmount } = renderPage();
    expect(screen.getByRole('tab', { name: /^Local/ }).getAttribute('aria-selected')).toBe('true');
    unmount();

    usePlayStore.getState().hideBoard();
    renderPage();
    expect(screen.getByRole('tab', { name: 'Play' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Alice · Bob')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(usePlayStore.getState().boardVisible).toBe(true);
    expect(screen.getByRole('tab', { name: /^Local/ }).getAttribute('aria-selected')).toBe('true');
    usePlayStore.getState().discardLocal();
  });

  it('opens the section a door names', () => {
    useAuth.setState({ user: null, status: 'guest' });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Track a table/ }));
    expect(screen.getByText('New local game')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Play' }));
    // Signed out, the online doors lead to the sign-in state, not a form.
    fireEvent.click(screen.getByRole('button', { name: /Join with a code/ }));
    expect(screen.getByRole('tab', { name: 'Online' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Online games need an account.')).toBeTruthy();
  });

  it('switches panels on tab click', () => {
    renderPage('/play/local');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet.')).toBeTruthy();
    expect(screen.queryByText('New local game')).toBeNull();
  });

  it('honors the /play/:section route for the initial tab', () => {
    renderPage('/play/history');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet.')).toBeTruthy();
  });
});

describe('Local setup — seat name field (B7-05)', () => {
  it('seeds the name field empty, not a live "Player N" value', () => {
    renderPage('/play/local');
    const seat1 = screen.getByRole('textbox', { name: 'Player 1 name' }) as HTMLInputElement;
    expect(seat1.value).toBe('');
    expect(seat1.placeholder).toBe('Player 1');
  });

  it('falls back to "Player N" for a seat left blank, without concatenating a typed name', () => {
    renderPage('/play/local');
    const seat2 = screen.getByRole('textbox', { name: 'Player 2 name' }) as HTMLInputElement;
    fireEvent.change(seat2, { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByText('Player 1')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText(/Player 1\w/)).toBeNull();
  });
});

describe('PlayPage rules door', () => {
  // The hero's own Rules pill duplicated the header door one row above it
  // (settled 2026-09-19): mid-game has the game menu, setup has the header.
  it('has no Rules button of its own', () => {
    renderPage('/play/local');
    expect(screen.queryByRole('button', { name: 'Rules' })).toBeNull();
  });
});

describe('Local setup — Horde (co-op)', () => {
  // A prior describe block's "Start game" click leaves `local` set on the
  // shared usePlayStore singleton; without this the form renders GameBoard
  // instead of LocalSetup.
  beforeEach(() => {
    usePlayStore.setState({ local: null, boardVisible: true });
  });
  afterEach(() => {
    usePlayStore.setState({ local: null });
  });

  function pickHorde() {
    fireEvent.click(screen.getByRole('button', { name: /Format/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Horde (co-op)' }));
  }

  it('swaps the Game/Rules sections for the horde tiles, difficulty and Customise', () => {
    renderPage('/play/local');
    pickHorde();
    expect(screen.getByText('Zombies')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Standard/ })).toBeTruthy();
    expect(screen.getByText('Customise')).toBeTruthy();
    // The real-format Rules pills are gone once Horde is picked.
    expect(screen.queryByText('Commander damage')).toBeNull();
    expect(screen.queryByText('Poison counters')).toBeNull();
  });

  it("difficulty rows spell out that survivor count's numbers, and update live", () => {
    renderPage('/play/local');
    pickHorde();
    // The form starts with 2 seats — resolveHordeSettings('standard', 2).
    const standardRow = screen.getByRole('radio', { name: /Standard/ }).closest('label')!;
    expect(within(standardRow).getByText(/60 shared life/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add player/ }));
    // A third seat re-resolves the preset at survivors = 3.
    const updatedRow = screen.getByRole('radio', { name: /Standard/ }).closest('label')!;
    expect(within(updatedRow).getByText(/80 shared life/)).toBeTruthy();
  });

  it("caps the roster at 1-4 survivors instead of the real game's 2-6", () => {
    renderPage('/play/local');
    pickHorde();
    expect(screen.getAllByRole('textbox', { name: /Player \d name/ })).toHaveLength(2);
    // 6 - 2 = 4 taps would overflow a real game's cap (6); Horde's cap (4)
    // is reached after only 2.
    const add = screen.getByRole('button', { name: /Add player/ });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByRole('textbox', { name: /Player \d name/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Add player/ })).toBeNull();
  });
});

function blankSeat(name: string) {
  return { name, deckId: null, deckName: null, commander: null, partner: null, colorIdentity: [] };
}

describe('Local setup — starting-life bracket memory', () => {
  beforeEach(() => {
    usePlayStore.setState({
      local: null,
      boardVisible: true,
      startingLifeTwoPlayer: null,
      startingLifeMultiplayer: null,
      tableProfiles: [],
    });
  });
  afterEach(() => {
    usePlayStore.setState({
      local: null,
      startingLifeTwoPlayer: null,
      startingLifeMultiplayer: null,
      tableProfiles: [],
    });
  });

  it('remembers a manual starting-life edit per bracket and swaps it back in when the count crosses 2↔3+', () => {
    renderPage('/play/local');
    const group = screen.getByRole('group', { name: 'Starting life' });
    const decrease = within(group).getByRole('button', { name: 'Decrease' });
    // Commander default is 40; dial the two-player bracket down to 30.
    fireEvent.click(decrease);
    fireEvent.click(decrease);
    expect(within(group).getByText('30')).toBeTruthy();

    // Crossing to 3 players: no memory yet for that bracket, so it falls
    // back to the picked format's own default (40), not the two-player 30.
    fireEvent.click(screen.getByRole('button', { name: 'Add player' }));
    expect(within(group).getByText('40')).toBeTruthy();

    // Back to 2: the two-player override reapplies.
    fireEvent.click(screen.getByRole('button', { name: /^Remove Player 3/ }));
    expect(within(group).getByText('30')).toBeTruthy();
  });

  it('picking a format always sets its canonical life, overriding a bracket override', () => {
    renderPage('/play/local');
    const group = screen.getByRole('group', { name: 'Starting life' });
    fireEvent.click(within(group).getByRole('button', { name: 'Decrease' }));
    expect(within(group).getByText('35')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Format/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Standard' }));
    expect(within(group).getByText('20')).toBeTruthy();
  });

  it("a loaded table profile's starting life wins over any remembered bracket override", () => {
    usePlayStore.setState({
      startingLifeTwoPlayer: 30,
      tableProfiles: [
        {
          id: 'p1',
          name: 'Thursday',
          savedAt: 1,
          setup: {
            format: 'commander',
            startingLife: 25,
            commanderDamageEnabled: true,
            poisonEnabled: false,
            players: [blankSeat('Alice'), blankSeat('Bob')],
          },
        },
      ],
    });
    renderPage('/play/local');
    fireEvent.click(screen.getByText('Thursday').closest('button')!);
    const group = screen.getByRole('group', { name: 'Starting life' });
    expect(within(group).getByText('25')).toBeTruthy();
  });
});

describe('Local setup — turn order', () => {
  beforeEach(() => {
    usePlayStore.setState({ local: null, boardVisible: true });
  });
  afterEach(() => {
    usePlayStore.setState({ local: null });
  });

  it('defaults to clockwise', () => {
    renderPage('/play/local');
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.turnOrder).toBe('clockwise');
  });

  it('flipping "Counterclockwise seating" carries turnOrder into the started game', () => {
    renderPage('/play/local');
    fireEvent.click(screen.getByRole('switch', { name: /Counterclockwise seating/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.turnOrder).toBe('counterclockwise');
  });

  it('a table profile round-trips counterclockwise seating', () => {
    renderPage('/play/local');
    fireEvent.click(screen.getByRole('switch', { name: /Counterclockwise seating/ }));
    fireEvent.change(screen.getByPlaceholderText('Thursday pod'), {
      target: { value: 'Thursday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = usePlayStore.getState().tableProfiles.find((p) => p.name === 'Thursday');
    expect(saved!.setup.turnOrder).toBe('counterclockwise');

    // Flip it back to clockwise on the live form, then reload the saved
    // profile — it should win, restoring counterclockwise.
    fireEvent.click(screen.getByRole('switch', { name: /Counterclockwise seating/ }));
    expect(
      screen.getByRole('switch', { name: /Counterclockwise seating/ }).getAttribute('aria-checked')
    ).toBe('false');
    fireEvent.click(screen.getByText('Thursday').closest('button')!);
    expect(
      screen.getByRole('switch', { name: /Counterclockwise seating/ }).getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.turnOrder).toBe('counterclockwise');
  });

  it('a legacy table profile (saved before turnOrder existed) loads as clockwise', () => {
    usePlayStore.setState({
      tableProfiles: [
        {
          id: 'legacy-1',
          name: 'Old table',
          savedAt: 1,
          setup: {
            format: 'commander',
            startingLife: 40,
            commanderDamageEnabled: true,
            poisonEnabled: false,
            players: [
              { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
              { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
            ],
            // No `turnOrder` key at all — the shape a profile saved before
            // this field existed actually has.
          },
        },
      ],
    });
    renderPage('/play/local');
    fireEvent.click(screen.getByRole('switch', { name: /Counterclockwise seating/ }));
    fireEvent.click(screen.getByText('Old table').closest('button')!);
    expect(
      screen.getByRole('switch', { name: /Counterclockwise seating/ }).getAttribute('aria-checked')
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.turnOrder).toBe('clockwise');
  });
});

describe('History — removing a game asks first', () => {
  // Playtest batch 7: the × on every history row removed the record on one
  // tap, with no confirmation and no undo, and it never came back.
  beforeEach(() => {
    usePlayStore.setState({
      history: [
        {
          id: 'rec-1',
          code: '',
          format: 'commander',
          startingLife: 40,
          players: [
            {
              seat: 0,
              userId: null,
              name: 'Ana',
              deckId: null,
              deckName: null,
              commander: null,
              finalLife: 40,
              eliminated: false,
            },
            {
              seat: 1,
              userId: null,
              name: 'Ben',
              deckId: null,
              deckName: null,
              commander: null,
              finalLife: 0,
              eliminated: true,
            },
          ],
          winnerSeat: 0,
          startedAt: 1_000,
          endedAt: 61_000,
          durationMs: 60_000,
          mode: 'local',
        },
      ],
    });
  });

  const openRowMenu = () => fireEvent.click(screen.getByRole('button', { name: /^Game options:/ }));

  // Delete is a VISIBLE control, not a menu entry — it was moved behind the
  // kebab once and became unfindable. Asserting the visible button keeps that
  // from silently regressing again.
  const clickRemove = () => fireEvent.click(screen.getByRole('button', { name: /^Remove game:/ }));

  it('keeps the row on Cancel and removes it only on confirm', () => {
    renderPage('/play/history');
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    clickRemove();
    expect(screen.getByText('Remove this game?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    expect(usePlayStore.getState().history).toHaveLength(1);
    clickRemove();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(usePlayStore.getState().history).toHaveLength(0);
    expect(screen.queryByText('Winner: Ana')).toBeNull();
  });

  it('corrects the winner from the row menu without deleting anything', () => {
    renderPage('/play/history');
    openRowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Correct this game' }));
    // Ben was eliminated, so he is offered but not selectable as the winner.
    const ben = screen.getByRole('radio', { name: /Ben/ }) as HTMLInputElement;
    expect(ben.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'No winner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(usePlayStore.getState().history).toHaveLength(1);
    expect(usePlayStore.getState().history[0].winnerSeat).toBe(null);
    expect(screen.getByText('No winner recorded')).toBeTruthy();
  });

  it('clears several games at once, asking once', () => {
    usePlayStore.setState((prev) => ({
      history: [
        ...prev.history,
        { ...prev.history[0], id: 'rec-2', endedAt: 62_000 },
        { ...prev.history[0], id: 'rec-3', endedAt: 63_000 },
      ],
    }));
    renderPage('/play/history');
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Clear 3 games?')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(usePlayStore.getState().history).toHaveLength(0);
  });
});

// Seats are people: signed in, a seat is a guest, you, or a friend, and a pod
// fills the roster in one tap. Guests' tables (every test above) are names.
describe('Local setup — seats are people', () => {
  beforeEach(() => {
    usePlayStore.setState({ local: null, history: [], pendingResults: [] });
    useAuth.setState({
      user: { id: 'me', username: 'georg', role: 'user' },
      status: 'authed',
      profile: null,
    });
  });
  afterEach(() => {
    useAuth.setState({ user: null, status: 'guest', profile: null });
    usePlayStore.setState({ local: null });
  });

  it('signed in, the dashboard shows the record and the join door opens the join form', async () => {
    usePlayStore.setState({
      history: [
        {
          id: 'r1',
          code: '',
          format: 'commander',
          startingLife: 40,
          players: [
            {
              seat: 0,
              userId: 'me',
              name: 'georg',
              deckId: 'd1',
              deckName: 'Atraxa',
              commander: null,
              finalLife: 12,
              eliminated: false,
            },
            {
              seat: 1,
              userId: null,
              name: 'Cal',
              deckId: null,
              deckName: null,
              commander: null,
              finalLife: 0,
              eliminated: true,
            },
          ],
          winnerSeat: 0,
          startedAt: 1,
          endedAt: 2,
          durationMs: 1,
          mode: 'local',
        },
      ],
    });
    renderPage();
    expect(screen.getByText('georg won')).toBeTruthy();
    const record = within(screen.getByLabelText('Your record'));
    expect(record.getByText('100%')).toBeTruthy();
    expect(record.getByText('Atraxa')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Join with a code/ }));
    expect(screen.getByText('Join a game')).toBeTruthy();
  });

  it('seats a friend: the name fills in and the started game carries their account', async () => {
    renderPage('/play/local');
    const who = await screen.findByRole('button', { name: 'Who is in seat 2' });
    fireEvent.click(who);
    fireEvent.click(screen.getByRole('option', { name: 'Bobby' }));
    const seat2 = screen.getByRole('textbox', { name: 'Player 2 name' }) as HTMLInputElement;
    expect(seat2.value).toBe('Bobby');

    fireEvent.click(screen.getByRole('button', { name: 'Who is in seat 1' }));
    fireEvent.click(screen.getByRole('option', { name: 'You' }));
    expect((screen.getByRole('textbox', { name: 'Player 1 name' }) as HTMLInputElement).value).toBe(
      'georg'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    const players = usePlayStore.getState().local!.players;
    expect(players.map((p) => [p.name, p.userId])).toEqual([
      ['georg', 'me'],
      ['Bobby', 'u-bob'],
    ]);
  });

  it('never offers an account that already holds another seat', async () => {
    renderPage('/play/local');
    fireEvent.click(await screen.findByRole('button', { name: 'Who is in seat 1' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bobby' }));
    fireEvent.click(screen.getByRole('button', { name: 'Who is in seat 2' }));
    expect(screen.queryByRole('option', { name: 'Bobby' })).toBeNull();
    expect(screen.getByRole('option', { name: 'You' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Guest' })).toBeTruthy();
  });

  it('seats a whole pod in one tap, you first', async () => {
    renderPage('/play/local');
    fireEvent.click(await screen.findByRole('button', { name: 'Thursday' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Player 3 name' })).toBeTruthy()
    );
    const names = [1, 2, 3].map(
      (n) => (screen.getByRole('textbox', { name: `Player ${n} name` }) as HTMLInputElement).value
    );
    expect(names).toEqual(['georg', 'Bobby', 'cal']);
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.players.map((p) => p.userId)).toEqual([
      'me',
      'u-bob',
      'u-cal',
    ]);
  });

  it("resolves a game night's account-backed seats once the friends list loads", async () => {
    usePlayStore.getState().seedGameSetup(
      [
        { name: 'Bobby', username: 'bob' },
        { name: 'Walk-up', username: null },
      ],
      'commander'
    );
    renderPage('/play/local');
    // The seat shows the account once the friends list has resolved it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Who is in seat 1' }).textContent).toContain(
        'Bobby'
      )
    );
    expect(screen.getByRole('button', { name: 'Who is in seat 2' }).textContent).toContain('Guest');
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(usePlayStore.getState().local!.players.map((p) => [p.name, p.userId])).toEqual([
      ['Bobby', 'u-bob'],
      ['Walk-up', null],
    ]);
  });
});

// One record per game, both modes in one list: the filter splits them on
// demand, and the × only exists where a removal is actually possible.
describe('History tab — local and online records together', () => {
  function rec(
    id: string,
    mode: GameRecord['mode'],
    winner: string,
    extra: Partial<GameRecord> = {}
  ) {
    return {
      id,
      code: mode === 'online' ? 'ABCD' : '',
      format: 'commander',
      startingLife: 40,
      players: [
        {
          seat: 0,
          userId: null,
          name: winner,
          deckId: null,
          deckName: null,
          commander: null,
          finalLife: 40,
          eliminated: false,
        },
      ],
      winnerSeat: 0,
      startedAt: 1_000,
      endedAt: 61_000,
      durationMs: 60_000,
      mode,
      ...extra,
    } as GameRecord;
  }

  afterEach(() => {
    useAuth.setState({ user: null, status: 'guest' });
  });

  it('shows the All / Local / Online filter only when both kinds exist, and it narrows the list', () => {
    usePlayStore.setState({ history: [rec('l', 'local', 'Ana')] });
    const { unmount } = renderPage('/play/history');
    expect(screen.queryByRole('tablist', { name: 'Which games' })).toBeNull();
    unmount();

    usePlayStore.setState({ history: [rec('l', 'local', 'Ana'), rec('o', 'online', 'Ben')] });
    renderPage('/play/history');
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    expect(screen.getByText('Winner: Ben')).toBeTruthy();
    // The page's own Local/Online tabs share these names — scope to the filter.
    const filter = within(screen.getByRole('tablist', { name: 'Which games' }));
    fireEvent.click(filter.getByRole('tab', { name: 'Online' }));
    expect(screen.queryByText('Winner: Ana')).toBeNull();
    expect(screen.getByText('Winner: Ben')).toBeTruthy();
    fireEvent.click(filter.getByRole('tab', { name: 'Local' }));
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    expect(screen.queryByText('Winner: Ben')).toBeNull();
  });

  it('deletes only what you recorded, and hides the rest instead', () => {
    useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' }, status: 'authed' });
    usePlayStore.setState({
      history: [
        rec('mine', 'local', 'Ana', { recordedByUserId: 'me' }),
        rec('theirs', 'local', 'Cal', { recordedByUserId: 'friend' }),
        rec('online', 'online', 'Ben'),
      ],
    });
    renderPage('/play/history');
    const rowFor = (winner: string) =>
      [...document.querySelectorAll('.play-history-item')].find((el) =>
        el.textContent?.includes(`Winner: ${winner}`)
      )!;
    const menuFor = (winner: string) =>
      rowFor(winner).querySelector<HTMLButtonElement>('[aria-label^="Game options:"]')!;
    const removeIn = (winner: string) =>
      rowFor(winner).querySelector('[aria-label^="Remove game:"]');

    // Your own local game: correctable, and deletable from the visible ×.
    expect(removeIn('Ana')).toBeTruthy();
    fireEvent.click(menuFor('Ana'));
    expect(screen.getByRole('menuitem', { name: 'Correct this game' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Hide from my list' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    // A friend's local game, and an online game you did not host, are someone
    // else's record: no × at all, and nothing to correct.
    for (const winner of ['Cal', 'Ben']) {
      expect(removeIn(winner)).toBeNull();
      fireEvent.click(menuFor(winner));
      expect(screen.queryByRole('menuitem', { name: 'Correct this game' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Hide from my list' })).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
    }
  });

  it('gives the host of an online game a delete, and says it hits everyone', () => {
    useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' }, status: 'authed' });
    usePlayStore.setState({
      history: [rec('mine-table', 'online', 'Ana', { hostUserId: 'me' })],
    });
    renderPage('/play/history');

    // The host gets the destructive control, not the hide-it-from-me one.
    fireEvent.click(screen.getByRole('button', { name: /^Remove game:/ }));
    expect(screen.getByText('Remove this game?')).toBeTruthy();
    // The copy must not claim this only leaves YOUR history — it does not.
    expect(screen.getByText(/leaves the record for everyone who played it/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(usePlayStore.getState().history).toHaveLength(0);
  });

  it('a seat that did not host the online game still only gets hide', () => {
    useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' }, status: 'authed' });
    usePlayStore.setState({
      history: [rec('their-table', 'online', 'Ben', { hostUserId: 'someone-else' })],
    });
    renderPage('/play/history');
    expect(screen.queryByRole('button', { name: /^Remove game:/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Game options:/ }));
    expect(screen.getByRole('menuitem', { name: 'Hide from my list' })).toBeTruthy();
  });
});

// E300 — the landing page's "Start a game" door deep-links here with `new=1`
// and must land on a RUNNING table, not the setup form. If this regresses the
// door silently becomes "one tap to a form", which is the thing it existed to
// fix.
describe('PlayPage — ?new=1 deep link', () => {
  const seat = (name: string) => ({
    name,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
  });

  beforeEach(() => {
    usePlayStore.setState({ local: null });
  });

  it('opens a running table on the Commander defaults, skipping the setup form', () => {
    renderPage('/play?new=1');
    expect(screen.queryByText('New local game')).toBeNull();
    // Exactly what an untouched LocalSetup would submit: 2 seats, blank names
    // falling back to "Player N", 40 life.
    expect(screen.getByText('Player 1')).toBeTruthy();
    expect(screen.getByText('Player 2')).toBeTruthy();
    expect(screen.queryByText('Player 3')).toBeNull();
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
  });

  it('never clobbers a game already in progress', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [seat('Alice'), seat('Bob')],
    });
    renderPage('/play?new=1');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText('Player 1')).toBeNull();
  });

  it('leaves a plain /play on the dashboard — no accidental auto-start', () => {
    renderPage('/play');
    expect(screen.getByRole('button', { name: /Track a table/ })).toBeTruthy();
    expect(usePlayStore.getState().local).toBeNull();
  });
});
