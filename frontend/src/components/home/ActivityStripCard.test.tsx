// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  DirectShareActivityItem,
  FeedbackActivityItem,
  DeckLikedActivityItem,
  FriendRequestActivityItem,
} from '../../lib/activity-client';

const mockUseActivity = vi.fn();
vi.mock('../../lib/use-activity', () => ({
  useActivity: () => mockUseActivity(),
}));

let authStatus: 'guest' | 'authed' = 'authed';
vi.mock('../../store/auth', () => ({
  useAuth: (selector: (s: { status: string }) => unknown) => selector({ status: authStatus }),
}));

import { ActivityStripCard } from './ActivityStripCard';

function renderCard() {
  return render(
    <MemoryRouter>
      <ActivityStripCard />
    </MemoryRouter>
  );
}

function friendRequest(id: string): FriendRequestActivityItem {
  return {
    type: 'friend_request',
    id: `fr:${id}`,
    requesterId: id,
    requesterUsername: id,
    requesterDisplayName: null,
    occurredAt: Date.now(),
  };
}

function directShare(): DirectShareActivityItem {
  return {
    type: 'direct_share',
    id: 'ds:1',
    token: 'tok-1',
    kind: 'deck',
    fromUsername: 'alice',
    fromDisplayName: null,
    label: 'Atraxa Superfriends',
    occurredAt: Date.now(),
  };
}

function feedback(): FeedbackActivityItem {
  return {
    type: 'feedback',
    id: 'fb:1',
    deckId: 'deck-1',
    deckName: 'Krenko Goblins',
    authorName: 'Bob',
    comment: 'Nice deck',
    occurredAt: Date.now(),
  };
}

function deckLiked(count = 3): DeckLikedActivityItem {
  return {
    type: 'deck_liked',
    id: 'dl:1',
    slug: 'krenko-goblins-ab12',
    deckName: 'Krenko Goblins',
    count,
    occurredAt: Date.now(),
  };
}

beforeEach(() => {
  authStatus = 'authed';
  mockUseActivity.mockReset();
  mockUseActivity.mockReturnValue({ count: 0, actionRequired: [], recent: [], loading: false });
});

describe('ActivityStripCard', () => {
  it('shows the loading skeleton while the feed is loading', () => {
    mockUseActivity.mockReturnValue({ count: 0, actionRequired: [], recent: [], loading: true });
    renderCard();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('shows guest copy when signed out', () => {
    authStatus = 'guest';
    renderCard();
    expect(screen.getByText('Sign in to see friend activity.')).toBeTruthy();
  });

  it('shows the empty message when authed with nothing pending', () => {
    renderCard();
    expect(screen.getByText('No new activity.')).toBeTruthy();
  });

  it('renders a friend-requests row linking to /you?friendsTab=requests', () => {
    mockUseActivity.mockReturnValue({
      count: 1,
      actionRequired: [friendRequest('r1')],
      recent: [],
      loading: false,
    });
    renderCard();
    const link = screen.getByRole('link', { name: '1 friend request waiting' });
    expect(link.getAttribute('href')).toBe('/you?friendsTab=requests');
  });

  it('pluralizes the friend-requests row for more than one', () => {
    mockUseActivity.mockReturnValue({
      count: 2,
      actionRequired: [friendRequest('r1'), friendRequest('r2')],
      recent: [],
      loading: false,
    });
    renderCard();
    expect(screen.getByRole('link', { name: '2 friend requests waiting' })).toBeTruthy();
  });

  it('links a direct_share row to /s/:token', () => {
    mockUseActivity.mockReturnValue({
      count: 1,
      actionRequired: [],
      recent: [directShare()],
      loading: false,
    });
    renderCard();
    const link = screen.getByRole('link', {
      name: 'alice shared a deck: Atraxa Superfriends, just now',
    });
    expect(link.getAttribute('href')).toBe('/s/tok-1');
  });

  it('links a feedback row to /decks/:deckId', () => {
    mockUseActivity.mockReturnValue({
      count: 1,
      actionRequired: [],
      recent: [feedback()],
      loading: false,
    });
    renderCard();
    const link = screen.getByRole('link', {
      name: 'Bob left feedback on Krenko Goblins, just now',
    });
    expect(link.getAttribute('href')).toBe('/decks/deck-1');
  });

  it('links a deck_liked row to /d/:slug and pluralizes by count', () => {
    mockUseActivity.mockReturnValue({
      count: 1,
      actionRequired: [],
      recent: [deckLiked(3)],
      loading: false,
    });
    renderCard();
    const link = screen.getByRole('link', {
      name: '3 people liked Krenko Goblins, just now',
    });
    expect(link.getAttribute('href')).toBe('/d/krenko-goblins-ab12');
  });

  it('singularizes deck_liked for a count of 1', () => {
    mockUseActivity.mockReturnValue({
      count: 1,
      actionRequired: [],
      recent: [deckLiked(1)],
      loading: false,
    });
    renderCard();
    expect(
      screen.getByRole('link', { name: '1 person liked Krenko Goblins, just now' })
    ).toBeTruthy();
  });

  it('caps recent rows at 3, newest-first order preserved as given', () => {
    mockUseActivity.mockReturnValue({
      count: 4,
      actionRequired: [],
      recent: [
        { ...feedback(), id: 'fb:1', deckName: 'Deck A' },
        { ...feedback(), id: 'fb:2', deckName: 'Deck B' },
        { ...feedback(), id: 'fb:3', deckName: 'Deck C' },
        { ...feedback(), id: 'fb:4', deckName: 'Deck D' },
      ],
      loading: false,
    });
    renderCard();
    expect(screen.getByText(/Deck A/)).toBeTruthy();
    expect(screen.getByText(/Deck B/)).toBeTruthy();
    expect(screen.getByText(/Deck C/)).toBeTruthy();
    expect(screen.queryByText(/Deck D/)).toBeNull();
  });
});
