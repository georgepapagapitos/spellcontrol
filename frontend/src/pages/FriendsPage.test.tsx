// @vitest-environment happy-dom
/**
 * FriendsPage — Activity tab (new-from-friends aggregated feed).
 *
 * Covers the lazy-fetch-once contract (fetch on first selection, never on
 * mount, never again on re-selection), both row-type renders, the empty
 * state, and the error+retry path. The other three tabs (Friends/Requests/
 * Inbox) are stubbed to empty/idle so this file stays scoped to Activity.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector({ status: 'authed' }),
}));

vi.mock('../lib/use-inbox', () => ({
  useInbox: () => ({ count: 0, items: [] }),
  markInboxSeen: vi.fn(),
}));

// vi.mock is hoisted above the file's own top-level code, so a variable
// referenced inside the factory must come from vi.hoisted (see
// ConfirmDialog.test.tsx's hapticsMock) or it TDZ-crashes.
const { mockGetFriendsActivity } = vi.hoisted(() => ({ mockGetFriendsActivity: vi.fn() }));
vi.mock('../lib/friends-client', () => ({
  searchUsers: vi.fn(() => Promise.resolve([])),
  sendFriendRequest: vi.fn(),
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
  cancelRequest: vi.fn(),
  removeFriend: vi.fn(),
  listFriends: vi.fn(() => Promise.resolve([])),
  listRequests: vi.fn(() => Promise.resolve({ incoming: [], outgoing: [] })),
  getFriendsActivity: mockGetFriendsActivity,
}));

import { FriendsPage } from './FriendsPage';

async function renderPage() {
  const utils = render(
    <MemoryRouter>
      <FriendsPage />
    </MemoryRouter>
  );
  await screen.findByRole('tablist');
  return utils;
}

function openActivityTab() {
  fireEvent.click(screen.getByRole('tab', { name: /activity/i }));
}

describe('FriendsPage — Activity tab', () => {
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
