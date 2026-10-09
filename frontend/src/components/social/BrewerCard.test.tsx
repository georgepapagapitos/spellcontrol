// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { BrewerCard as BrewerCardData } from '@/lib/social/brewers-client';
import { brewerStatsLine } from '@/lib/social/brewer-stats';
import { BrewerCard, BrewerCardSkeleton } from './BrewerCard';

function brewer(over: Partial<BrewerCardData> = {}): BrewerCardData {
  return {
    username: 'ada',
    displayName: 'Ada Brews',
    avatarImageUrl: null,
    bannerImage: 'https://cards.example/art.jpg',
    deckCount: 3,
    followerCount: 12,
    topColors: ['U', 'R'],
    topCommander: 'Niv-Mizzet, Parun',
    joinedAt: 1,
    ...over,
  };
}

function renderCard(b: BrewerCardData, variant?: 'card' | 'row' | 'featured') {
  return render(
    <MemoryRouter>
      <ul>
        <BrewerCard brewer={b} variant={variant} />
      </ul>
    </MemoryRouter>
  );
}

describe('brewerStatsLine', () => {
  it('shows followers only from the public-count floor', () => {
    expect(brewerStatsLine(brewer({ deckCount: 1, followerCount: 4 }))).toBe('1 deck');
    expect(brewerStatsLine(brewer({ deckCount: 3, followerCount: 5 }))).toBe(
      '3 decks · 5 followers'
    );
    expect(brewerStatsLine(brewer({ followerCount: 1200 }))).toContain('followers');
  });
});

describe('BrewerCard', () => {
  it('is one link to the profile, named by identity and stats', () => {
    renderCard(brewer());
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/u/ada');
    expect(link.getAttribute('aria-label')).toMatch(/^Ada Brews, @ada, 3 decks · 12 followers/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Brews Niv-Mizzet, Parun')).toBeTruthy();
  });

  it('renders the banner art lazily and decoratively', () => {
    const { container } = renderCard(brewer());
    const img = container.querySelector('img.brewer-card-art');
    expect(img?.getAttribute('src')).toBe('https://cards.example/art.jpg');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('alt')).toBe('');
    expect(container.querySelector('.color-identity-bar-seg--u')).not.toBeNull();
  });

  it('falls back to the flat banner without art, and to the handle without a name', () => {
    const { container } = renderCard(
      brewer({ bannerImage: null, displayName: null, topCommander: null, topColors: [] })
    );
    expect(container.querySelector('.brewer-card-fallback')).not.toBeNull();
    expect(container.querySelector('img.brewer-card-art')).toBeNull();
    expect(screen.getByRole('link').getAttribute('aria-label')).toMatch(/^ada, 3 decks/);
    expect(container.querySelector('.color-identity-bar-seg--c')).not.toBeNull();
    expect(screen.queryByText(/^Brews /)).toBeNull();
  });

  it('row variant has no banner or color bar', () => {
    const { container } = renderCard(brewer(), 'row');
    expect(container.querySelector('.brewer-card--row')).not.toBeNull();
    expect(container.querySelector('.brewer-card-banner')).toBeNull();
    expect(container.querySelector('.color-identity-bar')).toBeNull();
  });

  it('featured variant carries its class', () => {
    const { container } = renderCard(brewer(), 'featured');
    expect(container.querySelector('.brewer-card--featured')).not.toBeNull();
  });

  it('skeleton is hidden from assistive tech', () => {
    const { container } = render(
      <ul>
        <BrewerCardSkeleton />
      </ul>
    );
    expect(container.querySelector('li')?.getAttribute('aria-hidden')).toBe('true');
  });
});
