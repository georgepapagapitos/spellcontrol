// @vitest-environment happy-dom
/**
 * FriendsManagement — guest gate, search-add, request actions, inbox, the
 * friendsTab deep-link contract, and the Activity tab (new-from-friends
 * aggregated feed).
 *
 * The Activity-tab block covers the lazy-fetch-once contract (fetch on first
 * selection, never on mount, never again on re-selection), both row-type
 * renders, the empty state, and the error+retry path.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above the file's own top-level code, so a variable
// referenced inside a factory must come from vi.hoisted (see
// ConfirmDialog.test.tsx's hapticsMock) or it TDZ-crashes. auth/inbox are
// mutable hoisted objects (not fixed factories) so the guest-gate and
// inbox tests below can flip them per test; afterEach resets both.
const { authState, inboxState } = vi.hoisted(() => ({
  authState: { status: 'authed' as 'authed' | 'guest' },
  inboxState: {
    count: 0,
    items: [] as Array<{
      token: string;
      kind: string;
      label: string;
      fromUsername: string;
      fromDisplayName: string | null;
      createdAt: number;
    }>,
  },
}));

vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector(authState),
}));

const { mockMarkInboxSeen } = vi.hoisted(() => ({ mockMarkInboxSeen: vi.fn() }));
vi.mock('../lib/use-inbox', () => ({
  useInbox: () => inboxState,
  markInboxSeen: mockMarkInboxSeen,
}));

// Stub payloads for the two calls whose resolved value isn't void — neither
// is ever read by FriendsManagement (both call sites discard it and instead
// patch local state directly), so the shape only needs to satisfy the type.
const STUB_SEND_REQUEST_RESULT = {
  friendStatus: 'request_sent' as const,
  addressee: { id: 'stub', username: 'stub', displayName: null },
};
const STUB_FRIEND = {
  id: 'stub',
  username: 'stub',
  displayName: null,
  friendedAt: 0,
  cardCount: 0,
};

const { mockGetFriendsActivity } = vi.hoisted(() => ({ mockGetFriendsActivity: vi.fn() }));
vi.mock('../lib/friends-client', () => ({
  searchUsers: vi.fn(() => Promise.resolve([])),
  sendFriendRequest: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(() => Promise.resolve()),
  cancelRequest: vi.fn(() => Promise.resolve()),
  removeFriend: vi.fn(() => Promise.resolve()),
  listFriends: vi.fn(() => Promise.resolve([])),
  listRequests: vi.fn(() => Promise.resolve({ incoming: [], outgoing: [] })),
  getFriendsActivity: mockGetFriendsActivity,
}));

import { FriendsManagement } from './FriendsManagement';
import {
  searchUsers,
  sendFriendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  removeFriend,
  listFriends,
  listRequests,
} from '../lib/friends-client';

async function renderPage(initialPath = '/') {
  const utils = render(
    <MemoryRouter initialEntries={[initialPath]}>
      {/* Stand-in for the heading YouPage renders around this component —
          the friendsTab deep-link effect scrolls/focuses it by id. */}
      <h2 id="you-friends-group-title">Friends</h2>
      <FriendsManagement />
    </MemoryRouter>
  );
  await screen.findByRole('tablist');
  return utils;
}

function openActivityTab() {
  fireEvent.click(screen.getByRole('tab', { name: /activity/i }));
}

beforeAll(() => {
  // happy-dom doesn't implement scrollIntoView; the friendsTab deep-link
  // effect calls it whenever a non-default tab is selected.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  authState.status = 'authed';
  inboxState.count = 0;
  inboxState.items = [];
  vi.mocked(searchUsers).mockReset().mockResolvedValue([]);
  vi.mocked(sendFriendRequest).mockReset().mockResolvedValue(STUB_SEND_REQUEST_RESULT);
  vi.mocked(acceptRequest).mockReset().mockResolvedValue(STUB_FRIEND);
  vi.mocked(declineRequest).mockReset().mockResolvedValue(undefined);
  vi.mocked(cancelRequest).mockReset().mockResolvedValue(undefined);
  vi.mocked(removeFriend).mockReset().mockResolvedValue(undefined);
  vi.mocked(listFriends).mockReset().mockResolvedValue([]);
  vi.mocked(listRequests).mockReset().mockResolvedValue({ incoming: [], outgoing: [] });
  mockMarkInboxSeen.mockReset();
});

describe('FriendsManagement — Activity tab', () => {
  beforeEach(() => {
    mockGetFriendsActivity.mockReset();
  });

  it('fetches activity on first selection only — not on mount, not on re-selection', async () => {
    mockGetFriendsActivity.mockResolvedValue([]);
    await renderPage();
    expect(mockGetFriendsActivity).not.toHaveBeenCalled();

    openActivityTab();
    await waitFor(() => expect(mockGetFriendsActivity).toHaveBeenCalledTimes(1));

    // Switch away and back — a successful load must not refetch.
    fireEvent.click(screen.getByRole('tab', { name: /^friends$/i }));
    openActivityTab();
    expect(mockGetFriendsActivity).toHaveBeenCalledTimes(1);
  });

  it('renders both row types with correct links and text', async () => {
    mockGetFriendsActivity.mockResolvedValue([
      {
        type: 'published_deck',
        friendUsername: 'alice',
        deckName: 'Boros Aggro',
        slug: 'boros-aggro-ab12',
        format: 'commander',
        occurredAt: Date.now() - 60_000,
      },
      {
        type: 'shared_content',
        friendUsername: 'bob',
        kind: 'deck',
        token: 'tok123',
        label: 'Golgari Midrange',
        occurredAt: Date.now() - 120_000,
      },
    ]);
    await renderPage();
    openActivityTab();

    const deckLink = await screen.findByRole('link', { name: /alice published Boros Aggro/i });
    expect(deckLink.getAttribute('href')).toBe('/d/boros-aggro-ab12');

    const shareLink = screen.getByRole('link', { name: /bob shared Golgari Midrange/i });
    expect(shareLink.getAttribute('href')).toBe('/s/tok123');
  });

  it('shows the empty state for a zero-item response', async () => {
    mockGetFriendsActivity.mockResolvedValue([]);
    await renderPage();
    openActivityTab();

    expect(await screen.findByText(/nothing new from friends yet/i)).toBeTruthy();
    expect(screen.getByText(/add friends or check back later/i, { exact: false })).toBeTruthy();
  });

  it('shows an error row with Retry, and a successful retry loads the list', async () => {
    mockGetFriendsActivity.mockRejectedValueOnce(new Error('Failed to load activity.'));
    await renderPage();
    openActivityTab();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Failed to load activity.');

    mockGetFriendsActivity.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByText(/nothing new from friends yet/i)).toBeTruthy();
    expect(mockGetFriendsActivity).toHaveBeenCalledTimes(2);
  });
});

describe('FriendsManagement — guest gate', () => {
  it('renders the sign-in prompt instead of the tabs, unchanged from FriendsPage', () => {
    authState.status = 'guest';
    render(
      <MemoryRouter>
        <h2 id="you-friends-group-title">Friends</h2>
        <FriendsManagement />
      </MemoryRouter>
    );

    expect(screen.getByText(/sign in to connect with friends/i)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    const signIn = screen.getByRole('link', { name: /^sign in$/i });
    expect(signIn.getAttribute('href')).toBe('/auth');
  });
});

describe('FriendsManagement — search and add', () => {
  it('searches by username and sends a friend request', async () => {
    vi.mocked(searchUsers).mockResolvedValue([
      { id: 'u2', username: 'bob', displayName: null, friendStatus: 'none' },
    ]);
    await renderPage();

    fireEvent.change(screen.getByRole('textbox', { name: /search users by username/i }), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    const addBtn = await screen.findByRole('button', { name: /^add bob$/i });
    fireEvent.click(addBtn);

    await waitFor(() => expect(sendFriendRequest).toHaveBeenCalledWith('bob'));
    expect(await screen.findByRole('button', { name: /^pending bob$/i })).toBeTruthy();
  });
});

describe('FriendsManagement — request and friend actions', () => {
  it('accepts an incoming request', async () => {
    vi.mocked(listRequests).mockResolvedValue({
      incoming: [
        {
          requesterId: 'r1',
          requesterUsername: 'carol',
          requesterDisplayName: null,
          addresseeId: 'me',
          addresseeUsername: 'me',
          addresseeDisplayName: null,
          createdAt: Date.now(),
        },
      ],
      outgoing: [],
    });
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^requests$/i }));

    const acceptBtn = await screen.findByRole('button', {
      name: /accept friend request from carol/i,
    });
    fireEvent.click(acceptBtn);

    await waitFor(() => expect(acceptRequest).toHaveBeenCalledWith('r1'));
  });

  it('declines an incoming request', async () => {
    vi.mocked(listRequests).mockResolvedValue({
      incoming: [
        {
          requesterId: 'r1',
          requesterUsername: 'carol',
          requesterDisplayName: null,
          addresseeId: 'me',
          addresseeUsername: 'me',
          addresseeDisplayName: null,
          createdAt: Date.now(),
        },
      ],
      outgoing: [],
    });
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^requests$/i }));

    const declineBtn = await screen.findByRole('button', {
      name: /decline friend request from carol/i,
    });
    fireEvent.click(declineBtn);

    await waitFor(() => expect(declineRequest).toHaveBeenCalledWith('r1'));
  });

  it('cancels an outgoing request', async () => {
    vi.mocked(listRequests).mockResolvedValue({
      incoming: [],
      outgoing: [
        {
          requesterId: 'me',
          requesterUsername: 'me',
          requesterDisplayName: null,
          addresseeId: 'r2',
          addresseeUsername: 'dave',
          addresseeDisplayName: null,
          createdAt: Date.now(),
        },
      ],
    });
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^requests$/i }));

    const cancelBtn = await screen.findByRole('button', {
      name: /cancel friend request to dave/i,
    });
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(cancelRequest).toHaveBeenCalledWith('r2'));
  });

  it('removes a friend', async () => {
    vi.mocked(listFriends).mockResolvedValue([
      { id: 'f1', username: 'erin', displayName: null, friendedAt: Date.now(), cardCount: 12 },
    ]);
    await renderPage();

    const removeBtn = await screen.findByRole('button', {
      name: /remove erin from friends/i,
    });
    fireEvent.click(removeBtn);

    await waitFor(() => expect(removeFriend).toHaveBeenCalledWith('f1'));
  });
});

describe('FriendsManagement — inbox', () => {
  it('renders a shared item and marks the inbox seen on arrival', async () => {
    inboxState.count = 1;
    inboxState.items = [
      {
        token: 'tok1',
        kind: 'deck',
        label: 'Boros Aggro',
        fromUsername: 'frank',
        fromDisplayName: null,
        createdAt: Date.now(),
      },
    ];
    await renderPage('/?friendsTab=inbox');

    const viewLink = await screen.findByRole('link', {
      name: /view boros aggro shared by frank/i,
    });
    expect(viewLink.getAttribute('href')).toBe('/s/tok1');
    await waitFor(() => expect(mockMarkInboxSeen).toHaveBeenCalled());
  });
});

describe('FriendsManagement — friendsTab deep link', () => {
  it('defaults to the Friends tab and does not steal focus when there is no friendsTab param', async () => {
    await renderPage('/');
    expect(screen.getByRole('tab', { name: /^friends$/i }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(document.activeElement?.id).not.toBe('you-friends-group-title');
  });

  it.each([
    ['requests', /^requests$/i],
    ['inbox', /^inbox$/i],
  ])(
    'selects the %s tab and scrolls/focuses the Friends heading',
    async (tabId, tabNamePattern) => {
      await renderPage(`/?friendsTab=${tabId}`);

      expect(screen.getByRole('tab', { name: tabNamePattern }).getAttribute('aria-selected')).toBe(
        'true'
      );
      await waitFor(() => expect(document.activeElement?.id).toBe('you-friends-group-title'));
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    }
  );
});
