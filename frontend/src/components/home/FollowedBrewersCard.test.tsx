// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { FollowedDeckPublishedActivityItem } from '@/lib/activity-client';
import { FollowedBrewersCard } from './FollowedBrewersCard';

function item(n: number): FollowedDeckPublishedActivityItem {
  return {
    type: 'followed_deck_published',
    id: `fdp:${n}`,
    slug: `deck-${n}`,
    deckName: `Deck ${n}`,
    brewerUsername: 'ada',
    brewerDisplayName: 'Ada Brews',
    occurredAt: Date.now() - 3_600_000,
  };
}

function renderCard(items: FollowedDeckPublishedActivityItem[], loading = false) {
  return render(
    <MemoryRouter>
      <FollowedBrewersCard items={items} loading={loading} />
    </MemoryRouter>
  );
}

describe('FollowedBrewersCard', () => {
  it('links the deck to /d/:slug and the brewer to their profile', () => {
    renderCard([item(1)]);
    expect(screen.getByRole('heading', { name: 'New from brewers you follow' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Deck 1' }).getAttribute('href')).toBe('/d/deck-1');
    expect(screen.getByRole('link', { name: 'Ada Brews' }).getAttribute('href')).toBe('/u/ada');
  });

  it('shows at most four rows', () => {
    renderCard([1, 2, 3, 4, 5, 6].map(item));
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders nothing when there is nothing new', () => {
    const { container } = renderCard([]);
    expect(container.querySelector('.home-card')).toBeNull();
  });
});
