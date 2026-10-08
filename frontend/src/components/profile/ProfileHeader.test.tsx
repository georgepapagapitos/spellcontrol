// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicProfile } from '@/lib/social/profile-client';
import { useAuth } from '@/store/auth';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { emptyDraft } from '@/lib/trade/trade-draft';
import { ProfileHeader } from './ProfileHeader';

function profile(over: Partial<PublicProfile> = {}): PublicProfile {
  return {
    username: 'ada',
    displayName: 'Ada Brews',
    bio: null,
    avatarCardName: null,
    avatarImageUrl: null,
    joinedAt: Date.UTC(2025, 0, 1),
    isOwner: false,
    moderationHidden: false,
    deckCount: 0,
    decks: [],
    followerCount: 0,
    followingCount: 0,
    viewerFollows: false,
    viewerIsFriend: true,
    ownerId: 'friend-1',
    stats: { likesReceived: 0, copiesReceived: 0 },
    topCommanders: [],
    colorSpread: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    pinnedDeckSlug: null,
    gameRecord: null,
    ...over,
  } as PublicProfile;
}

function renderHeader(p: PublicProfile) {
  return render(
    <MemoryRouter>
      <ProfileHeader
        profile={p}
        heading="Ada Brews"
        handle="@ada"
        joined="January 2025"
        onReport={() => {}}
      />
    </MemoryRouter>
  );
}

function seedDraft(viewerId: string, friendId: string, quantity: number) {
  const d = emptyDraft(friendId, 'Ada Brews');
  d.get = { 'oracle-1': { name: 'Sol Ring', quantity } };
  useTradeDraftsStore.getState().setDraft(viewerId, friendId, d);
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'viewer-1' } } as never);
  useTradeDraftsStore.setState({ drafts: {} });
});
afterEach(() => {
  useAuth.setState({ user: null } as never);
  useTradeDraftsStore.setState({ drafts: {} });
});

describe('ProfileHeader trade entry points', () => {
  it('shows Trade, beside Follow, for a friend carrying an ownerId', () => {
    renderHeader(profile());
    const trade = screen.getByRole('link', { name: 'Trade' });
    expect(trade.getAttribute('href')).toBe('/friends/friend-1?tab=collection');
    expect(screen.getByRole('button', { name: /Follow/ })).toBeTruthy();
  });

  it('hides Trade for a stranger (no ownerId)', () => {
    renderHeader(profile({ ownerId: undefined, viewerIsFriend: false }));
    expect(screen.queryByRole('link', { name: 'Trade' })).toBeNull();
  });

  it('hides Trade on your own profile', () => {
    renderHeader(profile({ isOwner: true }));
    expect(screen.queryByRole('link', { name: 'Trade' })).toBeNull();
  });

  it('shows no Resume line without a draft', () => {
    renderHeader(profile());
    expect(screen.queryByText(/draft trade/)).toBeNull();
  });

  it('shows Resume with the card count, linking into the review', () => {
    seedDraft('viewer-1', 'friend-1', 2);
    renderHeader(profile());
    expect(screen.getByText(/You have a draft trade with Ada Brews · 2 cards/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Resume' }).getAttribute('href')).toBe(
      '/friends/friend-1?tab=collection&review=1'
    );
  });

  it('ignores another viewer’s draft and another friend’s draft', () => {
    seedDraft('someone-else', 'friend-1', 2);
    seedDraft('viewer-1', 'friend-2', 2);
    renderHeader(profile());
    expect(screen.queryByText(/draft trade/)).toBeNull();
  });
});
