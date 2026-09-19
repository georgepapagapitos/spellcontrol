// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayPage } from './PlayPage';
import { useRulesReferenceStore } from '../store/rules-reference';
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
      <PlayPage />
    </MemoryRouter>
  );
}

describe('PlayPage tabs', () => {
  it('renders Local/Online/Game nights/History through the shared Tabs primitive', () => {
    const { container } = renderPage();
    const tablist = screen.getByRole('tablist', { name: 'Play sections' });
    expect(tablist.classList.contains('sc-tabs')).toBe(true);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Local', 'Online', 'Game nights', 'History']);
    // No hand-rolled strip left behind.
    expect(container.querySelector('.play-tabs')).toBeNull();
  });

  it('defaults to the Local tab with roving tabindex', () => {
    renderPage();
    const local = screen.getByRole('tab', { name: 'Local' });
    expect(local.getAttribute('aria-selected')).toBe('true');
    expect(local.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Online' }).getAttribute('tabindex')).toBe('-1');
    // Local setup form is the visible panel.
    expect(screen.getByText('New local game')).toBeTruthy();
  });

  it('switches panels on tab click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet.')).toBeTruthy();
    expect(screen.queryByText('New local game')).toBeNull();
  });

  it('honors the ?tab= query param for the initial tab', () => {
    renderPage('/play?tab=history');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet.')).toBeTruthy();
  });
});

describe('Local setup — seat name field (B7-05)', () => {
  it('seeds the name field empty, not a live "Player N" value', () => {
    renderPage();
    const seat1 = screen.getByRole('textbox', { name: 'Player 1 name' }) as HTMLInputElement;
    expect(seat1.value).toBe('');
    expect(seat1.placeholder).toBe('Player 1');
  });

  it('falls back to "Player N" for a seat left blank, without concatenating a typed name', () => {
    renderPage();
    const seat2 = screen.getByRole('textbox', { name: 'Player 2 name' }) as HTMLInputElement;
    fireEvent.change(seat2, { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByText('Player 1')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText(/Player 1\w/)).toBeNull();
  });
});

describe('PlayPage rules button', () => {
  it('opens the rules reference sheet', () => {
    renderPage();
    expect(useRulesReferenceStore.getState().isOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(useRulesReferenceStore.getState().isOpen).toBe(true);
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

  it('keeps the row on Cancel and removes it only on confirm', () => {
    renderPage('/play?tab=history');
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Remove game:/ }));
    expect(screen.getByText('Remove this game?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Winner: Ana')).toBeTruthy();
    expect(usePlayStore.getState().history).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Remove game:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(usePlayStore.getState().history).toHaveLength(0);
    expect(screen.queryByText('Winner: Ana')).toBeNull();
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

  it('seats a friend: the name fills in and the started game carries their account', async () => {
    renderPage();
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
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Who is in seat 1' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bobby' }));
    fireEvent.click(screen.getByRole('button', { name: 'Who is in seat 2' }));
    expect(screen.queryByRole('option', { name: 'Bobby' })).toBeNull();
    expect(screen.getByRole('option', { name: 'You' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Guest' })).toBeTruthy();
  });

  it('seats a whole pod in one tap, you first', async () => {
    renderPage();
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
    renderPage();
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
    const { unmount } = renderPage('/play?tab=history');
    expect(screen.queryByRole('tablist', { name: 'Which games' })).toBeNull();
    unmount();

    usePlayStore.setState({ history: [rec('l', 'local', 'Ana'), rec('o', 'online', 'Ben')] });
    renderPage('/play?tab=history');
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

  it('offers removal for a local game you hold, never for an online game or one a friend recorded', () => {
    useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' }, status: 'authed' });
    usePlayStore.setState({
      history: [
        rec('mine', 'local', 'Ana', { recordedByUserId: 'me' }),
        rec('theirs', 'local', 'Cal', { recordedByUserId: 'friend' }),
        rec('online', 'online', 'Ben'),
      ],
    });
    renderPage('/play?tab=history');
    const removes = screen.getAllByRole('button', { name: /^Remove game:/ });
    expect(removes).toHaveLength(1);
    // The one × sits on Ana's (mine) row.
    expect(removes[0].closest('.play-history-item')?.textContent).toContain('Winner: Ana');
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

  it('leaves a plain /play on the setup form — no accidental auto-start', () => {
    renderPage('/play');
    expect(screen.getByText('New local game')).toBeTruthy();
    expect(usePlayStore.getState().local).toBeNull();
  });
});
