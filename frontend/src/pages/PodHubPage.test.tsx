// @vitest-environment happy-dom
/**
 * PodHubPage — owner-vs-member-vs-invited control gating, remove/delete
 * two-step confirms, rename, invite-more, the nulled-username shared-history
 * table, the leaderboard, and what-the-pod-plays' three per-member states.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the file's own top-level code — a variable read
// inside a factory must come from vi.hoisted (see FriendsManagement.test.tsx
// / PodsIndexPage.test.tsx).
const { authState } = vi.hoisted(() => ({
  authState: {
    status: 'authed' as 'authed' | 'guest',
    user: { id: 'me', username: 'viewer', role: 'user' } as {
      id: string;
      username: string;
      role: string;
    } | null,
  },
}));

vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

vi.mock('../lib/friends-client', () => ({
  listFriends: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../lib/share-client', () => ({
  getFriendShares: vi.fn(() =>
    Promise.resolve({ ownerUsername: '', ownerDisplayName: null, shares: [] })
  ),
}));

vi.mock('../lib/pods-client', () => {
  class PodNotFoundError extends Error {}
  return {
    getPod: vi.fn(),
    renamePod: vi.fn(),
    deletePod: vi.fn(),
    removePodMember: vi.fn(),
    acceptPodInvite: vi.fn(() => Promise.resolve()),
    declinePodInvite: vi.fn(() => Promise.resolve()),
    invitePodMembers: vi.fn(() => Promise.resolve({ invited: [] })),
    fetchPodGames: vi.fn(() => Promise.resolve([])),
    fetchPodLeaderboard: vi.fn(() => Promise.resolve([])),
    PodNotFoundError,
  };
});

import { PodHubPage } from './PodHubPage';
import { listFriends } from '../lib/friends-client';
import { getFriendShares } from '../lib/share-client';
import {
  acceptPodInvite,
  declinePodInvite,
  deletePod,
  fetchPodGames,
  fetchPodLeaderboard,
  getPod,
  invitePodMembers,
  removePodMember,
  renamePod,
  PodNotFoundError,
  type PodDetail,
} from '../lib/pods-client';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/pods/pod1']}>
      <Routes>
        <Route path="/pods" element={<div data-testid="pods-index-stub">Pods index</div>} />
        <Route path="/pods/:id" element={<PodHubPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function podDetail(overrides: Partial<PodDetail> = {}): PodDetail {
  return {
    id: 'pod1',
    name: 'Friday crew',
    ownerUserId: 'owner1',
    ownerUsername: 'sam',
    createdAt: 1,
    myStatus: 'member',
    members: [
      { userId: 'owner1', username: 'sam', status: 'member', joinedAt: 1 },
      { userId: 'me', username: 'viewer', status: 'member', joinedAt: 2 },
    ],
    ...overrides,
  };
}

afterEach(() => {
  authState.status = 'authed';
  authState.user = { id: 'me', username: 'viewer', role: 'user' };
  vi.mocked(getPod).mockReset();
  vi.mocked(renamePod).mockReset();
  vi.mocked(deletePod).mockReset().mockResolvedValue(undefined);
  vi.mocked(removePodMember).mockReset().mockResolvedValue(undefined);
  vi.mocked(acceptPodInvite).mockReset().mockResolvedValue(undefined);
  vi.mocked(declinePodInvite).mockReset().mockResolvedValue(undefined);
  vi.mocked(invitePodMembers).mockReset().mockResolvedValue({ invited: [] });
  vi.mocked(fetchPodGames).mockReset().mockResolvedValue([]);
  vi.mocked(fetchPodLeaderboard).mockReset().mockResolvedValue([]);
  vi.mocked(listFriends).mockReset().mockResolvedValue([]);
  vi.mocked(getFriendShares)
    .mockReset()
    .mockResolvedValue({ ownerUsername: '', ownerDisplayName: null, shares: [] });
});

describe('PodHubPage — owner vs member vs invited controls', () => {
  it('owner sees invite, delete, rename, and per-member remove controls', async () => {
    authState.user = { id: 'owner1', username: 'sam', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(
      podDetail({
        members: [
          { userId: 'owner1', username: 'sam', status: 'member', joinedAt: 1 },
          { userId: 'bob1', username: 'bob', status: 'member', joinedAt: 2 },
        ],
      })
    );
    renderPage();

    expect(await screen.findByRole('button', { name: /invite more people/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete pod/i })).toBeTruthy();
    expect(screen.getByTitle('Rename pod')).toBeTruthy();
    expect(screen.getByRole('button', { name: /remove bob from pod/i })).toBeTruthy();
  });

  it('a plain member sees none of the owner controls', async () => {
    authState.user = { id: 'bob1', username: 'bob', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(
      podDetail({
        members: [
          { userId: 'owner1', username: 'sam', status: 'member', joinedAt: 1 },
          { userId: 'bob1', username: 'bob', status: 'member', joinedAt: 2 },
        ],
      })
    );
    renderPage();

    expect(await screen.findByText('Friday crew')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /invite more people/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete pod/i })).toBeNull();
    expect(screen.queryByTitle('Rename pod')).toBeNull();
    expect(screen.queryByRole('button', { name: /remove sam from pod/i })).toBeNull();
  });

  it('an invited-not-accepted viewer sees the roster plus accept/decline but no owner controls', async () => {
    authState.user = { id: 'invitee1', username: 'pat', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(
      podDetail({
        myStatus: 'invited',
        members: [
          { userId: 'owner1', username: 'sam', status: 'member', joinedAt: 1 },
          { userId: 'invitee1', username: 'pat', status: 'invited', joinedAt: null },
        ],
      })
    );
    renderPage();

    expect(await screen.findByText('sam')).toBeTruthy();
    expect(screen.getByText('pat')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /invite more people/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /delete pod/i })).toBeNull();
    // Not a member yet — the stats/what-the-pod-plays endpoints never fire.
    expect(fetchPodGames).not.toHaveBeenCalled();
    expect(fetchPodLeaderboard).not.toHaveBeenCalled();
  });
});

describe('PodHubPage — not-found', () => {
  it('renders the not-found state with a working back-link on a 404', async () => {
    vi.mocked(getPod).mockRejectedValue(new PodNotFoundError());
    renderPage();

    expect(await screen.findByText(/pod not found/i)).toBeTruthy();
    const backLink = screen.getByRole('link', { name: /back to pods/i });
    expect(backLink.getAttribute('href')).toBe('/pods');
  });
});

describe('PodHubPage — rename', () => {
  it('commits a rename on Enter', async () => {
    authState.user = { id: 'owner1', username: 'sam', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(podDetail());
    vi.mocked(renamePod).mockResolvedValue('Saturday crew');
    renderPage();

    fireEvent.click(await screen.findByTitle('Rename pod'));
    const input = screen.getByLabelText('Pod name');
    fireEvent.change(input, { target: { value: 'Saturday crew' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(renamePod).toHaveBeenCalledWith('pod1', 'Saturday crew'));
    expect(await screen.findByText('Saturday crew')).toBeTruthy();
  });
});

describe('PodHubPage — remove member / delete pod', () => {
  it('remove-member confirms before calling the API', async () => {
    authState.user = { id: 'owner1', username: 'sam', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(
      podDetail({
        members: [
          { userId: 'owner1', username: 'sam', status: 'member', joinedAt: 1 },
          { userId: 'bob1', username: 'bob', status: 'member', joinedAt: 2 },
        ],
      })
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /remove bob from pod/i }));
    expect(removePodMember).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(removePodMember).toHaveBeenCalledWith('pod1', 'bob1'));
  });

  it('delete-pod confirms before calling the API and navigates to /pods on success', async () => {
    authState.user = { id: 'owner1', username: 'sam', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(podDetail());
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /delete pod/i }));
    expect(deletePod).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(deletePod).toHaveBeenCalledWith('pod1'));
    expect(await screen.findByTestId('pods-index-stub')).toBeTruthy();
  });
});

describe('PodHubPage — invite more people', () => {
  it('posts the checked friend ids', async () => {
    authState.user = { id: 'owner1', username: 'sam', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(podDetail());
    vi.mocked(listFriends).mockResolvedValue([
      { id: 'f1', username: 'newfriend', displayName: null, friendedAt: 1, cardCount: 0 },
    ]);
    vi.mocked(invitePodMembers).mockResolvedValue({ invited: ['f1'] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /invite more people/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /newfriend/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(invitePodMembers).toHaveBeenCalledWith('pod1', ['f1']));
  });
});

describe('PodHubPage — shared history', () => {
  it('renders a fixture game list using the nulled-username shape', async () => {
    vi.mocked(getPod).mockResolvedValue(podDetail());
    vi.mocked(fetchPodGames).mockResolvedValue([
      {
        sessionId: 's1',
        code: 'CODE',
        format: 'commander',
        startingLife: 40,
        winnerSeat: 0,
        winnerUserId: null,
        startedAt: 1,
        endedAt: 1700000000000,
        durationMs: 99,
        participants: [
          {
            seat: 0,
            userId: null,
            username: null,
            name: 'Alice',
            deckId: null,
            deckName: null,
            commander: null,
            colorIdentity: [],
            finalLife: 40,
            eliminated: false,
          },
          {
            seat: 1,
            userId: null,
            username: null,
            name: 'Bob',
            deckId: null,
            deckName: null,
            commander: null,
            colorIdentity: [],
            finalLife: 0,
            eliminated: true,
          },
        ],
      },
    ]);
    renderPage();

    // Players cell — the frontend never assumes `username` is present, it
    // renders the in-game `name` only.
    expect(await screen.findByText('Alice, Bob')).toBeTruthy();
    expect(screen.getByText('Commander')).toBeTruthy();
    // Winner resolved via winnerSeat against participants, not winnerUserId.
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows the empty state for zero games', async () => {
    vi.mocked(getPod).mockResolvedValue(podDetail());
    vi.mocked(fetchPodGames).mockResolvedValue([]);
    // Leaderboard renders the identical empty copy when it's also empty (the
    // afterEach default) — scope to the history panel specifically so the
    // query doesn't ambiguously match both.
    renderPage();

    const heading = await screen.findByText('Shared history');
    const panel = heading.closest('.deck-stats-panel') as HTMLElement;
    // The heading renders before the fetch resolves — wait (findBy, not
    // getBy) for the empty copy to actually replace the loading skeleton.
    expect(await within(panel).findByText(/no games yet/i)).toBeTruthy();
  });
});

describe('PodHubPage — leaderboard', () => {
  it('renders standings in the order the server returns them (wins, then win%)', async () => {
    vi.mocked(getPod).mockResolvedValue(podDetail());
    vi.mocked(fetchPodLeaderboard).mockResolvedValue([
      { userId: 'owner1', username: 'sam', played: 4, wins: 3, winRate: 0.75 },
      { userId: 'me', username: 'viewer', played: 4, wins: 1, winRate: 0.25 },
      { userId: 'carol1', username: 'carol', played: 2, wins: 0, winRate: 0 },
    ]);
    renderPage();

    // The "Leaderboard" heading renders on the very first paint (before the
    // fetch resolves) — wait for an actual standings row scoped to this panel
    // (roster/what-the-pod-plays also render "sam" for the default fixture's
    // owner, so an unscoped wait would be ambiguous).
    const heading = await screen.findByText('Leaderboard');
    const panel = heading.closest('.deck-stats-panel') as HTMLElement;
    await within(panel).findByText('sam');
    const rows = within(panel).getAllByRole('row').slice(1); // drop the header row
    expect(within(rows[0]).getByText('sam')).toBeTruthy();
    expect(within(rows[1]).getByText('viewer')).toBeTruthy();
    expect(within(rows[2]).getByText('carol')).toBeTruthy();
  });
});

describe('PodHubPage — what the pod plays', () => {
  it('renders all three per-member states from a mixed friends/non-friends fixture', async () => {
    authState.user = { id: 'me', username: 'viewer', role: 'user' };
    vi.mocked(getPod).mockResolvedValue(
      podDetail({
        ownerUserId: 'me',
        members: [
          { userId: 'me', username: 'viewer', status: 'member', joinedAt: 1 },
          { userId: 'friend-with-decks', username: 'alice', status: 'member', joinedAt: 2 },
          { userId: 'friend-no-decks', username: 'bob', status: 'member', joinedAt: 3 },
          { userId: 'stranger', username: 'carol', status: 'member', joinedAt: 4 },
        ],
      })
    );
    vi.mocked(listFriends).mockResolvedValue([
      {
        id: 'friend-with-decks',
        username: 'alice',
        displayName: null,
        friendedAt: 1,
        cardCount: 0,
      },
      { id: 'friend-no-decks', username: 'bob', displayName: null, friendedAt: 1, cardCount: 0 },
    ]);
    vi.mocked(getFriendShares).mockImplementation((friendId: string) => {
      if (friendId === 'friend-with-decks') {
        return Promise.resolve({
          ownerUsername: 'alice',
          ownerDisplayName: null,
          shares: [
            {
              token: 't1',
              kind: 'deck' as const,
              resourceId: 'd1',
              label: 'Atraxa deck',
              createdAt: 1,
            },
          ],
        });
      }
      return Promise.resolve({ ownerUsername: 'bob', ownerDisplayName: null, shares: [] });
    });
    renderPage();

    expect(await screen.findByText('1 deck')).toBeTruthy();
    expect(screen.getByText('Atraxa deck')).toBeTruthy();
    expect(screen.getByText('No decks shared yet')).toBeTruthy();
    expect(screen.getByText('Friend them to see decks')).toBeTruthy();
    // getFriendShares is only ever called for mutual friends, never for the
    // non-friend row — "zero new backend calls" beyond that per-friend fetch.
    expect(getFriendShares).not.toHaveBeenCalledWith('stranger');
  });
});
