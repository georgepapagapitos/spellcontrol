// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BrewerCard } from '@/lib/social/brewers-client';

vi.mock('@/lib/social/brewers-client', () => ({
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
}));

import { FollowingPanel } from './FollowingPanel';

function brewer(username: string): BrewerCard {
  return {
    username,
    displayName: null,
    avatarImageUrl: null,
    bannerImage: null,
    deckCount: 2,
    followerCount: 0,
    topColors: ['G'],
    topCommander: null,
    joinedAt: 1,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof FollowingPanel>>) {
  return render(
    <MemoryRouter>
      <FollowingPanel brewers={[]} error={null} onRetry={() => {}} {...props} />
    </MemoryRouter>
  );
}

describe('FollowingPanel', () => {
  it('shows skeleton rows while loading', () => {
    renderPanel({ brewers: null });
    expect(document.querySelectorAll('.brewer-card--skeleton')).toHaveLength(3);
  });

  it('invites you to Discover when you follow no one', () => {
    renderPanel({ brewers: [] });
    expect(screen.getByText("You aren't following anyone yet.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Find brewers' }).getAttribute('href')).toBe(
      '/decks/discover/brewers'
    );
  });

  it('shows the error with a working Retry', () => {
    const onRetry = vi.fn();
    renderPanel({ brewers: [], error: "Couldn't load who you follow. Try again.", onRetry });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load who you follow");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('lists each brewer as a profile link with an Unfollow toggle beside it', () => {
    renderPanel({ brewers: [brewer('ada'), brewer('bo')] });
    const list = screen.getByRole('list', { name: 'Brewers you follow' });
    expect(list.querySelectorAll('a[href="/u/ada"]')).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: 'Follow ada' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toContain('Following');
    // The toggle is a sibling of the card link, never nested inside it.
    expect(toggle.closest('a')).toBeNull();
  });
});
