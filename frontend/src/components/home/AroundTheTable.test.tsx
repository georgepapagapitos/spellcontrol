// @vitest-environment happy-dom
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import type { GameNight, NightOption } from '../../lib/game-nights-api';
import type { RecentActivityItem } from '../../lib/activity-client';
import type { FriendActivityItem } from '../../lib/friends-client';

const authState = vi.hoisted(() => ({ status: 'authed' as 'authed' | 'guest' }));
vi.mock('../../store/auth', () => ({
  useAuth: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

const mockGetFriendsActivity = vi.hoisted(() => vi.fn());
vi.mock('../../lib/friends-client', () => ({
  getFriendsActivity: mockGetFriendsActivity,
}));

const mockRsvpGameNight = vi.hoisted(() => vi.fn());
vi.mock('../../lib/game-nights-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/game-nights-api')>();
  return { ...actual, rsvpGameNight: mockRsvpGameNight };
});

const mockToastShow = vi.hoisted(() => vi.fn());
vi.mock('../../store/toasts', () => ({
  toast: { show: mockToastShow },
}));

import { AroundTheTable } from './AroundTheTable';

function makeNight(overrides: Partial<GameNight> = {}): GameNight {
  return {
    id: 'night-1',
    token: 'tok-1',
    title: 'Friday Commander',
    startsAt: Date.now() + 2 * 86_400_000,
    timezone: null,
    location: null,
    notes: null,
    createdAt: Date.now(),
    cancelledAt: null,
    inviteOnly: false,
    format: null,
    venue: 'table',
    hostUsername: 'host',
    isHost: false,
    myStatus: null,
    myTradeOptIn: false,
    rsvps: [],
    awaiting: [],
    options: [],
    series: null,
    blocked: [],
    guestInvites: [],
    ...overrides,
  };
}

function directShare(
  overrides: Partial<Extract<RecentActivityItem, { type: 'direct_share' }>> = {}
): RecentActivityItem {
  return {
    type: 'direct_share',
    id: 'a1',
    token: 'tok-share',
    kind: 'deck',
    fromUsername: 'bob',
    fromDisplayName: null,
    label: 'My Deck',
    occurredAt: Date.now(),
    ...overrides,
  };
}

function feedback(
  overrides: Partial<Extract<RecentActivityItem, { type: 'feedback' }>> = {}
): RecentActivityItem {
  return {
    type: 'feedback',
    id: 'a2',
    deckId: 'deck-1',
    deckName: 'My Deck',
    authorName: 'Alice',
    comment: 'Nice deck',
    occurredAt: Date.now(),
    ...overrides,
  };
}

function deckLiked(
  overrides: Partial<Extract<RecentActivityItem, { type: 'deck_liked' }>> = {}
): RecentActivityItem {
  return {
    type: 'deck_liked',
    id: 'a3',
    slug: 'my-deck',
    deckName: 'My Deck',
    count: 1,
    occurredAt: Date.now(),
    ...overrides,
  };
}

function tradeResolved(
  overrides: Partial<Extract<RecentActivityItem, { type: 'trade_resolved' }>> = {}
): RecentActivityItem {
  return {
    type: 'trade_resolved',
    id: 'a4',
    offerId: 'o1',
    withUserId: 'u1',
    withUsername: 'carol',
    withDisplayName: null,
    outcome: 'accepted',
    occurredAt: Date.now(),
    ...overrides,
  };
}

function publishedDeck(
  overrides: Partial<Extract<FriendActivityItem, { type: 'published_deck' }>> = {}
): FriendActivityItem {
  return {
    type: 'published_deck',
    friendUsername: 'dana',
    deckName: 'Dana Deck',
    slug: 'dana-deck',
    format: 'commander',
    occurredAt: Date.now(),
    ...overrides,
  };
}

function sharedContent(
  overrides: Partial<Extract<FriendActivityItem, { type: 'shared_content' }>> = {}
): FriendActivityItem {
  return {
    type: 'shared_content',
    friendUsername: 'dana',
    kind: 'binder',
    token: 'tok-shared',
    label: 'Dana Binder',
    occurredAt: Date.now(),
    ...overrides,
  };
}

function renderTable(props: Partial<ComponentProps<typeof AroundTheTable>> = {}) {
  return render(
    <MemoryRouter>
      <AroundTheTable
        nights={[]}
        nightsLoading={false}
        nightsError={null}
        refreshNights={vi.fn().mockResolvedValue(undefined)}
        recent={[]}
        activityLoading={false}
        {...props}
      />
    </MemoryRouter>
  );
}

function activityColumn() {
  return screen.getByText('Activity').closest('.home-table-col') as HTMLElement;
}

function friendsColumn() {
  return screen.getByText('New from friends').closest('.home-table-col') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('sc-home-shape');
  authState.status = 'authed';
  mockGetFriendsActivity.mockResolvedValue([]);
});

describe('AroundTheTable', () => {
  it('a guest sees one quiet line with a sign-in door, and never fetches friend activity', () => {
    authState.status = 'guest';
    renderTable();
    const link = screen.getByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe('/auth?returnTo=%2Fhome');
    expect(mockGetFriendsActivity).not.toHaveBeenCalled();
  });

  it('is one quiet line when there is nothing planned and no activity', async () => {
    renderTable();
    await waitFor(() =>
      expect(screen.getByText('No game nights planned and no friend activity yet.')).toBeTruthy()
    );
    expect(screen.getByRole('link', { name: 'Plan a game night' }).getAttribute('href')).toBe(
      '/play/nights'
    );
    expect(screen.getByRole('link', { name: 'Find friends' }).getAttribute('href')).toBe(
      '/friends?tab=friends'
    );
  });

  it('shows the HomeCard skeleton while loading', () => {
    renderTable({ nightsLoading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('renders the next game night with an RSVP group reflecting myStatus', async () => {
    renderTable({ nights: [makeNight({ title: 'Friday Commander', myStatus: 'maybe' })] });
    await waitFor(() => expect(screen.getByText('Friday Commander')).toBeTruthy());
    const group = screen.getByRole('group', { name: 'RSVP to Friday Commander' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    const going = buttons.find((b) => b.textContent === 'Going');
    const maybe = buttons.find((b) => b.textContent === 'Maybe');
    expect(going?.getAttribute('aria-pressed')).toBe('false');
    expect(maybe?.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking Going RSVPs, then refreshes', async () => {
    const refreshNights = vi.fn().mockResolvedValue(undefined);
    mockRsvpGameNight.mockResolvedValue({ id: 'r1', displayName: 'me', status: 'going' });
    renderTable({
      nights: [makeNight({ token: 'tok-x', title: 'Friday Commander', myStatus: null })],
      refreshNights,
    });
    await waitFor(() => expect(screen.getByText('Friday Commander')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    await waitFor(() => expect(refreshNights).toHaveBeenCalled());
    expect(mockRsvpGameNight).toHaveBeenCalledWith('tok-x', { status: 'going' });
  });

  it('a rejected RSVP toasts an error and re-enables the buttons', async () => {
    mockRsvpGameNight.mockRejectedValueOnce(new Error("Couldn't save your RSVP."));
    renderTable({ nights: [makeNight({ title: 'Friday Commander', myStatus: null })] });
    await waitFor(() => expect(screen.getByText('Friday Commander')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Going' }));
    await waitFor(() =>
      expect(mockToastShow).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }))
    );
    expect(screen.getByRole('button', { name: 'Going' }).hasAttribute('disabled')).toBe(false);
  });

  it('a host sees a hosting note and no RSVP group', async () => {
    renderTable({
      nights: [makeNight({ title: 'Friday Commander', isHost: true, myStatus: 'going' })],
    });
    await waitFor(() => expect(screen.getByText('Friday Commander')).toBeTruthy());
    expect(screen.getByText("You're hosting.")).toBeTruthy();
    expect(screen.queryByRole('group', { name: /^RSVP to/ })).toBeNull();
  });

  it('a polling night links to vote on a date instead of an RSVP group', async () => {
    const options: NightOption[] = [
      { id: 'o1', startsAt: Date.now() + 86_400_000, proposedBy: null, voters: [], myVote: false },
    ];
    renderTable({ nights: [makeNight({ title: 'Saturday Draft', options })] });
    await waitFor(() => expect(screen.getByText('Saturday Draft')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Vote on a date' }).getAttribute('href')).toBe(
      '/play/nights'
    );
  });

  it('shows Nothing planned with a door when there is activity but no upcoming night', async () => {
    renderTable({ recent: [feedback()] });
    await waitFor(() => expect(screen.getByText('Nothing planned.')).toBeTruthy());
    const doors = screen.getAllByRole('link', { name: 'Plan a game night' });
    expect(doors.some((d) => d.getAttribute('href') === '/play/nights')).toBe(true);
  });

  it('a direct share links to /s/:token', async () => {
    renderTable({ recent: [directShare({ token: 'tok-abc' })] });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    expect(within(activityColumn()).getByRole('link').getAttribute('href')).toBe('/s/tok-abc');
  });

  it('feedback links to /decks/:deckId', async () => {
    renderTable({ recent: [feedback({ deckId: 'deck-9' })] });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    expect(within(activityColumn()).getByRole('link').getAttribute('href')).toBe('/decks/deck-9');
  });

  it('a deck like with one liker uses singular wording and links to /d/:slug', async () => {
    renderTable({ recent: [deckLiked({ slug: 'my-deck', count: 1 })] });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    const link = within(activityColumn()).getByRole('link');
    expect(link.getAttribute('href')).toBe('/d/my-deck');
    expect(link.textContent).toContain('1 person liked');
  });

  it('a deck like with several likers uses plural wording', async () => {
    renderTable({ recent: [deckLiked({ slug: 'my-deck', count: 3 })] });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    expect(within(activityColumn()).getByRole('link').textContent).toContain('3 people liked');
  });

  it('a resolved trade links to /friends/:withUserId', async () => {
    renderTable({ recent: [tradeResolved({ withUserId: 'u-77' })] });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    expect(within(activityColumn()).getByRole('link').getAttribute('href')).toBe('/friends/u-77');
  });

  it('caps recent-activity rows at 3', async () => {
    renderTable({
      recent: [
        directShare({ id: 'a1' }),
        feedback({ id: 'a2' }),
        deckLiked({ id: 'a3' }),
        tradeResolved({ id: 'a4' }),
      ],
    });
    await waitFor(() => expect(activityColumn()).toBeTruthy());
    expect(within(activityColumn()).getAllByRole('link')).toHaveLength(3);
  });

  it("a friend's published deck links to /d/:slug", async () => {
    mockGetFriendsActivity.mockResolvedValue([publishedDeck({ slug: 'dana-deck' })]);
    renderTable();
    await waitFor(() => expect(friendsColumn()).toBeTruthy());
    expect(within(friendsColumn()).getByRole('link').getAttribute('href')).toBe('/d/dana-deck');
  });

  it("a friend's shared content links to /s/:token", async () => {
    mockGetFriendsActivity.mockResolvedValue([sharedContent({ token: 'tok-shared' })]);
    renderTable();
    await waitFor(() => expect(friendsColumn()).toBeTruthy());
    expect(within(friendsColumn()).getByRole('link').getAttribute('href')).toBe('/s/tok-shared');
  });

  it('caps friend rows at 3', async () => {
    mockGetFriendsActivity.mockResolvedValue([
      publishedDeck({ slug: 'a' }),
      publishedDeck({ slug: 'b' }),
      sharedContent({ token: 'c' }),
      sharedContent({ token: 'd' }),
    ]);
    renderTable();
    await waitFor(() => expect(friendsColumn()).toBeTruthy());
    expect(within(friendsColumn()).getAllByRole('link')).toHaveLength(3);
  });

  it('a friends fetch error shows Retry, which re-fetches', async () => {
    mockGetFriendsActivity.mockRejectedValueOnce(new Error('offline'));
    renderTable();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'));

    mockGetFriendsActivity.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading friend activity' }));
    await waitFor(() => expect(mockGetFriendsActivity).toHaveBeenCalledTimes(2));
  });

  it('a nights error shows Retry, which calls refreshNights', async () => {
    const refreshNights = vi.fn().mockResolvedValue(undefined);
    renderTable({ nightsError: 'Could not load nights.', refreshNights });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not load nights.')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading game nights' }));
    expect(refreshNights).toHaveBeenCalled();
  });
});
