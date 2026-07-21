// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FriendActivityItem } from '../../lib/friends-client';

const mockGetFriendsActivity = vi.fn<() => Promise<FriendActivityItem[]>>();
vi.mock('../../lib/friends-client', () => ({
  getFriendsActivity: () => mockGetFriendsActivity(),
}));

let authStatus: 'guest' | 'authed' = 'authed';
vi.mock('../../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector({ status: authStatus }),
}));

import { NewFromFriendsCard } from './NewFromFriendsCard';

function renderCard() {
  return render(
    <MemoryRouter>
      <NewFromFriendsCard />
    </MemoryRouter>
  );
}

beforeEach(() => {
  authStatus = 'authed';
  mockGetFriendsActivity.mockReset();
});

describe('NewFromFriendsCard', () => {
  it('shows guest copy and never fetches when signed out', () => {
    authStatus = 'guest';
    renderCard();
    expect(screen.getByText('Sign in to see what friends are sharing.')).toBeTruthy();
    expect(mockGetFriendsActivity).not.toHaveBeenCalled();
  });

  it('shows the loading skeleton, then the empty message when authed with nothing new', async () => {
    mockGetFriendsActivity.mockResolvedValue([]);
    renderCard();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nothing new from friends yet.')).toBeTruthy());
  });

  it('links a published_deck row to /d/:slug', async () => {
    mockGetFriendsActivity.mockResolvedValue([
      {
        type: 'published_deck',
        friendUsername: 'alice',
        deckName: 'Atraxa Superfriends',
        slug: 'atraxa-superfriends-ab12',
        format: 'commander',
        occurredAt: Date.now(),
      },
    ]);
    renderCard();
    const link = await screen.findByRole('link', {
      name: 'alice published Atraxa Superfriends, just now',
    });
    expect(link.getAttribute('href')).toBe('/d/atraxa-superfriends-ab12');
  });

  it('links a shared_content row to /s/:token', async () => {
    mockGetFriendsActivity.mockResolvedValue([
      {
        type: 'shared_content',
        friendUsername: 'bob',
        kind: 'collection',
        token: 'tok-99',
        label: 'My Collection',
        occurredAt: Date.now(),
      },
    ]);
    renderCard();
    const link = await screen.findByRole('link', {
      name: 'bob shared My Collection, just now',
    });
    expect(link.getAttribute('href')).toBe('/s/tok-99');
  });

  it('caps rows at 3', async () => {
    mockGetFriendsActivity.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        type: 'published_deck' as const,
        friendUsername: 'alice',
        deckName: `Deck ${i}`,
        slug: `deck-${i}`,
        format: 'commander',
        occurredAt: Date.now(),
      }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByText(/Deck 0/)).toBeTruthy());
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows an error with Retry, and Retry re-fetches', async () => {
    mockGetFriendsActivity.mockRejectedValueOnce(new Error('network down'));
    renderCard();
    await waitFor(() => expect(screen.getByText('network down')).toBeTruthy());

    mockGetFriendsActivity.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await waitFor(() => expect(screen.getByText('Nothing new from friends yet.')).toBeTruthy());
  });

  it("renders the friend's avatar as the row's visual anchor (initial-letter fallback, no photo on this feed)", async () => {
    mockGetFriendsActivity.mockResolvedValue([
      {
        type: 'published_deck',
        friendUsername: 'alice',
        deckName: 'Atraxa Superfriends',
        slug: 'atraxa-superfriends-ab12',
        format: 'commander',
        occurredAt: Date.now(),
      },
    ]);
    const { container } = renderCard();
    await screen.findByRole('link', { name: /alice published/ });
    const avatar = container.querySelector('.user-avatar-fallback');
    expect(avatar?.textContent).toBe('A');
  });
});
