// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import type { ActionRequiredItem } from '../../lib/activity-client';
import type { GameNight, NightOption } from '../../lib/game-nights-api';
import type { PriceTargetHit } from '../../lib/price-alerts';

const collection = vi.hoisted(() => ({
  cards: [] as unknown[],
  binders: [] as unknown[],
  lists: [] as unknown[],
  hydrating: false,
}));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: typeof collection) => unknown) => sel(collection),
}));

const decksState = vi.hoisted(() => ({ decks: [] as unknown[], hydrated: true }));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: typeof decksState) => unknown) => sel(decksState),
}));

const awaiting = vi.hoisted(() => ({ value: false }));
vi.mock('../../lib/use-awaiting-first-pull', () => ({
  useAwaitingFirstPull: () => awaiting.value,
}));

const review = vi.hoisted(() => ({
  value: { count: 0, binderCount: 0 } as { count: number; binderCount: number } | null,
}));
vi.mock('./use-binder-review-count', () => ({
  useBinderReviewCount: () => review.value,
}));

const priceHits = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('../../lib/price-alerts', () => ({
  findPriceTargetHits: () => priceHits.value,
}));

import { WaitingOnYou } from './WaitingOnYou';
import { readHomeShape } from '../../lib/home-shape';

function tradeOffer(overrides: Partial<Extract<ActionRequiredItem, { type: 'trade_offer' }>> = {}) {
  return {
    type: 'trade_offer',
    id: 'offer-1',
    offerId: 'o1',
    fromUserId: 'u1',
    fromUsername: 'bob',
    fromDisplayName: null,
    giveCount: 1,
    receiveCount: 1,
    occurredAt: Date.now(),
    ...overrides,
  } satisfies ActionRequiredItem;
}

function friendRequest(
  overrides: Partial<Extract<ActionRequiredItem, { type: 'friend_request' }>> = {}
) {
  return {
    type: 'friend_request',
    id: 'req-1',
    requesterId: 'r1',
    requesterUsername: 'alice',
    requesterDisplayName: null,
    occurredAt: Date.now(),
    ...overrides,
  } satisfies ActionRequiredItem;
}

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

function priceHit(overrides: Partial<PriceTargetHit> = {}): PriceTargetHit {
  return {
    entryId: 'e1',
    name: 'Sol Ring',
    listId: 'l1',
    listName: 'Wants',
    price: 1,
    targetPrice: 2,
    currency: 'USD',
    ...overrides,
  };
}

function renderWaiting(props: Partial<ComponentProps<typeof WaitingOnYou>> = {}) {
  return render(
    <MemoryRouter>
      <WaitingOnYou
        actionRequired={[]}
        activityLoading={false}
        nights={[]}
        nightsLoading={false}
        {...props}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('sc-home-shape');
  collection.cards = [];
  collection.binders = [];
  collection.lists = [];
  collection.hydrating = false;
  decksState.decks = [];
  decksState.hydrated = true;
  awaiting.value = false;
  review.value = { count: 0, binderCount: 0 };
  priceHits.value = [];
});

describe('WaitingOnYou', () => {
  it('renders nothing while loading when there is no remembered shape', () => {
    const { container } = renderWaiting({ activityLoading: true });
    expect(container.innerHTML).toBe('');
  });

  it('renders a loading skeleton while loading when the last visit had tasks', () => {
    localStorage.setItem('sc-home-shape', JSON.stringify({ waiting: 1 }));
    renderWaiting({ activityLoading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('renders nothing once settled with no tasks, and remembers the empty shape', () => {
    const { container } = renderWaiting();
    expect(container.innerHTML).toBe('');
    expect(readHomeShape()['waiting']).toBe(0);
  });

  it('one trade offer links to the sender', () => {
    renderWaiting({
      actionRequired: [
        tradeOffer({ fromUserId: 'u1', fromUsername: 'bob', fromDisplayName: null }),
      ],
    });
    const link = screen.getByRole('link', { name: 'Trade offer from bob' });
    expect(link.getAttribute('href')).toBe('/friends/u1');
  });

  it('two or more trade offers point at /trades instead', () => {
    renderWaiting({
      actionRequired: [
        tradeOffer({ id: 'a1', fromUserId: 'u1' }),
        tradeOffer({ id: 'a2', fromUserId: 'u2' }),
      ],
    });
    const link = screen.getByRole('link', { name: '2 trade offers waiting on you' });
    expect(link.getAttribute('href')).toBe('/trades');
  });

  it('one friend request uses singular wording', () => {
    renderWaiting({ actionRequired: [friendRequest()] });
    const link = screen.getByRole('link', { name: '1 friend request waiting' });
    expect(link.getAttribute('href')).toBe('/friends?tab=requests');
  });

  it('multiple friend requests use plural wording', () => {
    renderWaiting({
      actionRequired: [
        friendRequest({ id: 'r1', requesterUsername: 'alice' }),
        friendRequest({ id: 'r2', requesterUsername: 'carol' }),
      ],
    });
    const link = screen.getByRole('link', { name: '2 friend requests waiting' });
    expect(link.getAttribute('href')).toBe('/friends?tab=requests');
  });

  it('an upcoming night with no reply yet gets a reply task', () => {
    renderWaiting({
      nights: [makeNight({ title: 'Friday Commander', myStatus: null, isHost: false })],
    });
    const link = screen.getByRole('link', { name: /^Friday Commander, .*: reply$/ });
    expect(link.getAttribute('href')).toBe('/play/nights');
  });

  it('a night already replied to gets no task', () => {
    const { container } = renderWaiting({
      nights: [makeNight({ myStatus: 'going', isHost: false })],
    });
    expect(container.innerHTML).toBe('');
  });

  it('a hosted night gets no task', () => {
    const { container } = renderWaiting({
      nights: [makeNight({ isHost: true, myStatus: null })],
    });
    expect(container.innerHTML).toBe('');
  });

  it('a polling night asks to vote on a date instead of reply', () => {
    const options: NightOption[] = [
      { id: 'o1', startsAt: Date.now() + 86_400_000, proposedBy: null, voters: [], myVote: false },
    ];
    renderWaiting({
      nights: [makeNight({ title: 'Saturday Draft', myStatus: null, isHost: false, options })],
    });
    const link = screen.getByRole('link', { name: 'Saturday Draft: vote on a date' });
    expect(link.getAttribute('href')).toBe('/play/nights');
  });

  it('a positive binder review count becomes a filing task', () => {
    review.value = { count: 5, binderCount: 2 };
    renderWaiting();
    const link = screen.getByRole('link', { name: '5 cards to file across 2 binders' });
    expect(link.getAttribute('href')).toBe('/collection/binders');
  });

  it('one price-target hit names the card', () => {
    priceHits.value = [priceHit({ name: 'Sol Ring', listName: 'Wants' })];
    renderWaiting();
    const link = screen.getByRole('link', { name: 'Sol Ring is under your target price on Wants' });
    expect(link.getAttribute('href')).toBe('/collection/lists');
  });

  it('several price-target hits collapse to a count', () => {
    priceHits.value = [
      priceHit({ entryId: 'e1', name: 'Sol Ring' }),
      priceHit({ entryId: 'e2', name: 'Mana Crypt' }),
    ];
    renderWaiting();
    const link = screen.getByRole('link', { name: '2 cards under your target price' });
    expect(link.getAttribute('href')).toBe('/collection/lists');
  });

  it('suggests a first binder when the collection has cards but no binders', () => {
    collection.cards = [{}];
    decksState.decks = [{}];
    renderWaiting();
    const link = screen.getByRole('link', { name: 'Build your first binder' });
    expect(link.getAttribute('href')).toBe('/collection/binders');
  });

  it('suggests a first deck when the collection has cards but no decks', () => {
    collection.cards = [{}];
    collection.binders = [{}];
    renderWaiting();
    const link = screen.getByRole('link', { name: 'Make a deck' });
    expect(link.getAttribute('href')).toBe('/decks/new');
  });

  it('suggests neither setup step for an empty collection', () => {
    const { container } = renderWaiting();
    expect(container.innerHTML).toBe('');
  });

  it('the count pill equals the number of tasks', () => {
    const { container } = renderWaiting({
      actionRequired: [friendRequest()],
      nights: [makeNight({ myStatus: null, isHost: false })],
    });
    const pill = container.querySelector('.home-waiting-count');
    expect(pill?.textContent).toBe('2');
    expect(pill?.getAttribute('aria-label')).toBe('2 items');
  });
});
