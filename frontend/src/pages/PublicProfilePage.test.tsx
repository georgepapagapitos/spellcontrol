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

const { fetchPublicProfileMock, fetchProfileCollectionMock } = vi.hoisted(() => ({
  fetchPublicProfileMock: vi.fn(),
  fetchProfileCollectionMock: vi.fn(),
}));
vi.mock('../lib/profile-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/profile-client')>();
  return {
    ...real,
    fetchPublicProfile: fetchPublicProfileMock,
    fetchProfileCollection: fetchProfileCollectionMock,
  };
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

function renderProfile(path = '/u/alice') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/u/:username" element={<PublicProfilePage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  fetchPublicProfileMock.mockReset();
  fetchProfileCollectionMock.mockReset();
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
    estimatedBracket: null,
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

describe('PublicProfilePage — the Collection tab (T136)', () => {
  const COLLECTION = {
    ownerUsername: 'alice',
    ownerDisplayName: null,
    cards: [
      {
        name: 'Sol Ring',
        scryfallId: 'sol',
        setCode: 'cmr',
        collectorNumber: '472',
        rarity: 'uncommon',
        finish: 'nonfoil',
        purchasePrice: 1.5,
        cmc: 1,
        typeLine: 'Artifact',
      },
    ],
  };

  it('shows Decks and Collection tabs when the viewer may see the collection, and loads it on open', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ collection: { visibility: 'public', canView: true } })
    );
    fetchProfileCollectionMock.mockResolvedValue(COLLECTION);
    renderProfile('/u/alice?tab=collection');
    expect(await screen.findByRole('tab', { name: 'Collection' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Decks' })).toBeTruthy();
    await waitFor(() => expect(fetchProfileCollectionMock).toHaveBeenCalledWith('alice'));
    expect(await screen.findByText(/1 card/)).toBeTruthy();
    // A stranger gets no owner controls.
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });

  it('has no Collection tab, and never fetches it, when the viewer may not see it', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ collection: { visibility: 'friends', canView: false } })
    );
    renderProfile('/u/alice?tab=collection');
    expect(await screen.findByText(/hasn.t shared any decks yet/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Collection' })).toBeNull();
    expect(fetchProfileCollectionMock).not.toHaveBeenCalled();
  });

  it('tells the owner who else sees it, with a way to change it', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ isOwner: true, collection: { visibility: null, canView: true } })
    );
    fetchProfileCollectionMock.mockResolvedValue(COLLECTION);
    renderProfile('/u/alice?tab=collection');
    expect(await screen.findByText(/Your friends see which cards you own/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('offers a retry when the collection fails to load', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ collection: { visibility: 'public', canView: true } })
    );
    fetchProfileCollectionMock.mockRejectedValueOnce(new Error('offline'));
    fetchProfileCollectionMock.mockResolvedValue(COLLECTION);
    renderProfile('/u/alice?tab=collection');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.click();
    expect(await screen.findByText(/1 card/)).toBeTruthy();
  });
});

describe('PublicProfilePage — a stranger reaching a profile with no public decks', () => {
  it('says so plainly, with no owner call to action', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile());
    renderProfile();
    expect(await screen.findByText("@alice hasn't shared any decks yet.")).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Go to your decks' })).toBeNull();
  });
});
