// @vitest-environment happy-dom
/**
 * The public profile's brand-bar action: strangers get Report; the owner
 * gets the way back to the editor on /you (the other half of the Profile
 * card's "public profile" link).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile, PublicProfileDeck } from '../lib/profile-client';
import { ProfileNotFoundError, ProfileRenamedError } from '../lib/profile-client';

const { fetchPublicProfileMock } = vi.hoisted(() => ({ fetchPublicProfileMock: vi.fn() }));
vi.mock('../lib/profile-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/profile-client')>();
  return { ...real, fetchPublicProfile: fetchPublicProfileMock };
});
vi.mock('../lib/use-panel-cascade', () => ({
  usePanelCascade: () => ({ animating: false }),
  panelCascadeClass: () => '',
}));

import { PublicProfilePage } from './PublicProfilePage';

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    username: 'alice',
    displayName: null,
    bio: null,
    avatarCardName: null,
    avatarImageUrl: null,
    joinedAt: Date.UTC(2025, 0, 1),
    isOwner: false,
    moderationHidden: false,
    deckCount: 0,
    decks: [],
    ...overrides,
  };
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/u/alice']}>
      <Routes>
        <Route path="/u/:username" element={<PublicProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  fetchPublicProfileMock.mockReset();
});

function deck(
  over: Partial<PublicProfileDeck> & { slug: string; name: string }
): PublicProfileDeck {
  return {
    format: 'commander',
    commanderName: null,
    commanderImage: null,
    colorIdentity: [],
    cardCount: 100,
    bracket: null,
    viewCount: 0,
    copyCount: 0,
    publishedAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('PublicProfilePage — the shelf reads the deck’s last update, not its publish date', () => {
  // Playtest batch 11: a deck edited 17 hours earlier read "4d ago" (its
  // publish date) and the "Updated" sort put a newer publish above it.
  it('stamps each tile with updatedAt and sorts by it', async () => {
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const now = Date.now();
    fetchPublicProfileMock.mockResolvedValue(
      profile({
        deckCount: 2,
        decks: [
          deck({
            slug: 'newer-publish',
            name: 'Newer publish',
            publishedAt: now - DAY,
            updatedAt: now - DAY,
          }),
          deck({
            slug: 'older-publish-edited',
            name: 'Older publish edited',
            publishedAt: now - 30 * DAY,
            updatedAt: now - 2 * HOUR,
          }),
        ],
      })
    );
    renderProfile();
    await screen.findByRole('link', { name: /Older publish edited/ });
    const names = [...document.querySelectorAll('.deck-library-tile .decks-index-card-name')].map(
      (n) => n.textContent?.trim()
    );
    expect(names).toEqual(['Older publish edited', 'Newer publish']);
    const stamps = [...document.querySelectorAll('.public-profile-tile-banner-stats')].map((s) =>
      s.textContent?.trim()
    );
    expect(stamps).toEqual(['2h ago', '1d ago']);
  });
});

describe('PublicProfilePage — brand-bar action', () => {
  it('offers Report to a stranger', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile());
    renderProfile();
    expect(await screen.findByRole('button', { name: 'Report this profile' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit profile' })).toBeNull();
  });

  it('offers the owner "Edit profile" to the Profile card on /you, not Report', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile({ isOwner: true }));
    renderProfile();
    const edit = await screen.findByRole('link', { name: 'Edit profile' });
    expect(edit.getAttribute('href')).toBe('/you?section=profile');
    expect(screen.queryByRole('button', { name: 'Report this profile' })).toBeNull();
  });
});

describe('PublicProfilePage — a handle that moved', () => {
  it('replaces the URL with the account current handle instead of 404ing', async () => {
    fetchPublicProfileMock.mockImplementation((username: string) =>
      username === 'alice'
        ? Promise.reject(new ProfileRenamedError('alicenew'))
        : Promise.resolve(profile({ username: 'alicenew' }))
    );

    render(
      <MemoryRouter initialEntries={['/u/alice']}>
        <Routes>
          <Route path="/u/:username" element={<PublicProfilePage />} />
        </Routes>
      </MemoryRouter>
    );

    // The page re-fetches under the new handle and renders it, rather than
    // showing the not-found state for a link that is merely old.
    await waitFor(() => expect(fetchPublicProfileMock).toHaveBeenCalledWith('alicenew'));
    expect(await screen.findByText('@alicenew')).toBeTruthy();
    expect(screen.queryByText(/does not exist/i)).toBeNull();
  });

  it('still shows not-found for a handle nobody ever had', async () => {
    fetchPublicProfileMock.mockRejectedValue(new ProfileNotFoundError());
    renderProfile();
    expect(await screen.findByText(/doesn't exist/i)).toBeTruthy();
  });
});
