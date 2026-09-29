// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrewerCard, BrewerRails } from '@/lib/brewers-client';

const { mockRails } = vi.hoisted(() => ({ mockRails: vi.fn() }));
vi.mock('@/lib/brewers-client', () => ({ fetchBrewerRails: mockRails }));

import { SuggestedBrewers } from './SuggestedBrewers';

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

function rails(over: Partial<BrewerRails>): BrewerRails {
  return {
    newest: [],
    mostLiked: [],
    mostFollowed: [],
    sharedCommanders: [],
    spotlight: null,
    ...over,
  };
}

function renderStrip() {
  return render(
    <MemoryRouter>
      <SuggestedBrewers />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockRails.mockReset();
});

describe('SuggestedBrewers', () => {
  it('leads with people who share your commanders', async () => {
    mockRails.mockResolvedValue(
      rails({ sharedCommanders: [brewer('shared')], newest: [brewer('fresh')] })
    );
    renderStrip();
    expect(await screen.findByRole('heading', { name: 'Brewers to meet' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /shared/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /fresh/ })).toBeNull();
  });

  it('falls back to the newest brewers', async () => {
    mockRails.mockResolvedValue(rails({ newest: [brewer('fresh')] }));
    renderStrip();
    expect(await screen.findByRole('link', { name: /fresh/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /see all/i }).getAttribute('href')).toBe(
      '/decks/discover/brewers'
    );
  });

  it('renders nothing when there is no one to suggest', async () => {
    mockRails.mockResolvedValue(rails({}));
    const { container } = renderStrip();
    await waitFor(() => expect(mockRails).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.querySelector('.suggested-brewers')).toBeNull();
  });

  it('renders nothing, with no error, when the request fails', async () => {
    mockRails.mockRejectedValue(new Error('offline'));
    const { container } = renderStrip();
    await waitFor(() => expect(mockRails).toHaveBeenCalled());
    await Promise.resolve();
    expect(container.querySelector('.suggested-brewers')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
