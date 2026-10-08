// @vitest-environment happy-dom
/**
 * The public profile's brand-bar action: strangers get Report; the owner
 * gets the way back to the editor on /you (the other half of the Profile
 * card's "public profile" link).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicProfile, PublicProfileDeck } from '@/lib/social/profile-client';
import { ProfileNotFoundError, ProfileRenamedError } from '@/lib/social/profile-client';
import { useAuth } from '@/store/auth';
import { useTradeDraftsStore } from '@/store/trade-drafts';

const { fetchPublicProfileMock, fetchProfileCollectionMock } = vi.hoisted(() => ({
  fetchPublicProfileMock: vi.fn(),
  fetchProfileCollectionMock: vi.fn(),
}));
vi.mock('@/lib/social/profile-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/social/profile-client')>();
  return {
    ...real,
    fetchPublicProfile: fetchPublicProfileMock,
    fetchProfileCollection: fetchProfileCollectionMock,
  };
});
vi.mock('@/lib/util/use-panel-cascade', () => ({
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
    followerCount: 0,
    followingCount: 0,
    viewerFollows: false,
    viewerIsFriend: false,
    stats: { likesReceived: 0, copiesReceived: 0 },
    topCommanders: [],
    colorSpread: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    pinnedDeckSlug: null,
    gameRecord: null,
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

beforeEach(() => {
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
    expect(edit.getAttribute('href')).toBe('/you/profile');
    expect(screen.queryByRole('button', { name: 'Report this profile' })).toBeNull();
  });
});

describe('PublicProfilePage — the house account', () => {
  it('says it is official and opens the full precons shelf instead of Report', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ isOfficial: true, deckCount: 197, displayName: 'SpellControl' })
    );
    renderProfile();
    const browse = await screen.findByRole('link', { name: 'Browse all 197 precons' });
    expect(browse.getAttribute('href')).toBe('/decks/discover?source=precons');
    expect(screen.getByText(/Official account/)).toBeTruthy();
    expect(screen.queryByText(/Joined/)).toBeNull();
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
    expect(await screen.findByText(/Only your friends can see your collection here/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    // The note shows before the collection's fetch has settled; the owner
    // sees their own cards under it too.
    expect(await screen.findByText(/1 card/)).toBeTruthy();
  });

  describe('trading from a friend’s profile (E586)', () => {
    const TRADEABLE = {
      ...COLLECTION,
      cards: [{ ...COLLECTION.cards[0], oracleId: 'o-sol', name: 'Sol Ring' }],
    };

    function Where() {
      const loc = useLocation();
      return <output data-testid="where">{loc.pathname + loc.search}</output>;
    }

    function renderWithHub() {
      return render(
        <MemoryRouter initialEntries={['/u/alice?tab=collection']}>
          <Routes>
            <Route path="/u/:username" element={<PublicProfilePage />} />
            <Route path="/friends/:friendId" element={<Where />} />
          </Routes>
        </MemoryRouter>
      );
    }

    beforeEach(() => {
      useAuth.setState({ status: 'authed', user: { id: 'viewer-1' } as never });
      useTradeDraftsStore.setState({ drafts: {} });
    });

    it('gives a friend the "+" and a tray that hands the review to the hub', async () => {
      fetchPublicProfileMock.mockResolvedValue(
        profile({
          ownerId: 'friend-9',
          viewerIsFriend: true,
          collection: { visibility: 'friends', canView: true },
        })
      );
      fetchProfileCollectionMock.mockResolvedValue(TRADEABLE);
      renderWithHub();

      fireEvent.click(await screen.findByRole('button', { name: 'Ask for Sol Ring' }));
      expect(useTradeDraftsStore.getState().getDraft('viewer-1', 'friend-9')?.get['o-sol']).toEqual(
        { name: 'Sol Ring', quantity: 1 }
      );

      fireEvent.click(screen.getByRole('button', { name: /^Review trade with/ }));
      expect(screen.getByTestId('where').textContent).toBe(
        '/friends/friend-9?tab=collection&review=1'
      );
    });

    it('gives a stranger no "+" and no tray', async () => {
      fetchPublicProfileMock.mockResolvedValue(
        profile({ collection: { visibility: 'public', canView: true } })
      );
      fetchProfileCollectionMock.mockResolvedValue(TRADEABLE);
      renderWithHub();

      await screen.findByText('Sol Ring');
      expect(screen.queryByRole('button', { name: /^Ask for/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Review trade/ })).toBeNull();
    });

    it('gives the owner no "+" on their own profile', async () => {
      fetchPublicProfileMock.mockResolvedValue(
        profile({
          isOwner: true,
          ownerId: 'viewer-1',
          collection: { visibility: null, canView: true },
        })
      );
      fetchProfileCollectionMock.mockResolvedValue(TRADEABLE);
      renderWithHub();

      await screen.findByText('Sol Ring');
      expect(screen.queryByRole('button', { name: /^Ask for/ })).toBeNull();
    });
  });

  it('keeps the collection mounted across a Decks round trip: search survives, one fetch', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ collection: { visibility: 'public', canView: true } })
    );
    fetchProfileCollectionMock.mockResolvedValue(COLLECTION);
    renderProfile('/u/alice?tab=collection');
    const box = (await screen.findByLabelText('Search cards')) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'sol' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Decks' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Collection' }));

    const again = screen.getByLabelText('Search cards') as HTMLInputElement;
    expect(again).toBe(box);
    expect(again.value).toBe('sol');
    expect(fetchProfileCollectionMock).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the collection fails to load', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      profile({ collection: { visibility: 'public', canView: true } })
    );
    fetchProfileCollectionMock.mockRejectedValueOnce(new Error('offline'));
    fetchProfileCollectionMock.mockResolvedValue(COLLECTION);
    renderProfile('/u/alice?tab=collection');
    const retry = await screen.findByRole('button', { name: 'Retry' });
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

describe('PublicProfilePage — banner, stats, follow and what they brew (T175)', () => {
  const rich = (over: Partial<PublicProfile> = {}) =>
    profile({
      deckCount: 2,
      followerCount: 12,
      followingCount: 3,
      stats: { likesReceived: 40, copiesReceived: 2 },
      decks: [
        deck({ slug: 'a', name: 'Atraxa Deck', commanderImage: 'a.jpg', commanderName: 'Atraxa' }),
        deck({
          slug: 'b',
          name: 'Korvold Deck',
          commanderImage: 'k.jpg',
          commanderName: 'Korvold',
        }),
      ],
      topCommanders: [{ name: 'Atraxa', image: 'top.jpg', deckCount: 2 }],
      colorSpread: { W: 1, U: 1, B: 2, R: 0, G: 2, C: 0 },
      ...over,
    });
  const bannerSrc = () => document.querySelector('.public-profile-banner img')?.getAttribute('src');

  it('shows the stat line, hiding likes and copies below the social-proof floor', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich());
    renderProfile();
    const stats = await screen.findByRole('list', { name: 'Profile stats' });
    expect(stats.textContent).toContain('2 decks');
    expect(stats.textContent).toContain('12 followers');
    expect(stats.textContent).toContain('3 following');
    expect(stats.textContent).toContain('40 likes');
    expect(stats.textContent).not.toContain('copies');
  });

  it('takes the banner from the pinned deck, else the top commander, else none', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich({ pinnedDeckSlug: 'b' }));
    const first = renderProfile();
    await screen.findByRole('list', { name: 'Profile stats' });
    expect(bannerSrc()).toBe('k.jpg');
    first.unmount();

    fetchPublicProfileMock.mockResolvedValue(rich());
    const second = renderProfile();
    await screen.findByRole('list', { name: 'Profile stats' });
    expect(bannerSrc()).toBe('top.jpg');
    second.unmount();

    fetchPublicProfileMock.mockResolvedValue(rich({ topCommanders: [] }));
    renderProfile();
    await screen.findByRole('list', { name: 'Profile stats' });
    expect(document.querySelector('.public-profile-banner')).toBeNull();
  });

  it('leads with the pinned deck as a featured tile, once', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich({ pinnedDeckSlug: 'b' }));
    renderProfile();
    const featured = await screen.findByRole('list', { name: 'Pinned deck' });
    expect(featured.textContent).toContain('Korvold Deck');
    expect(screen.getAllByText('Korvold Deck')).toHaveLength(1);
  });

  it('lists repeated commanders linking to Discover, under the colour spread', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich());
    renderProfile();
    const link = await screen.findByRole('link', { name: /Atraxa\s*2 decks/ });
    expect(link.getAttribute('href')).toBe('/decks/discover?commander=Atraxa');
    expect(screen.getByRole('list', { name: 'Decks by color' })).toBeTruthy();
    expect(screen.getByText('Decks per color, across 2 decks')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Most-built commanders' })).toBeTruthy();
  });

  it('leaves out commanders built only once, keeping the colors', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      rich({
        topCommanders: [
          { name: 'Ulamog', image: 'u.jpg', deckCount: 1 },
          { name: 'Zada', image: 'z.jpg', deckCount: 1 },
        ],
      })
    );
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Colors' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Most-built commanders' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Ulamog/ })).toBeNull();
  });

  it('renders no Colors panel and no game record for an empty brewer', async () => {
    fetchPublicProfileMock.mockResolvedValue(profile());
    renderProfile();
    await screen.findByRole('list', { name: 'Profile stats' });
    expect(screen.queryByRole('heading', { name: 'Colors' })).toBeNull();
    expect(screen.queryByText('Game record')).toBeNull();
  });

  it('shows the game record only when the owner opted in', async () => {
    fetchPublicProfileMock.mockResolvedValue(
      rich({ gameRecord: { games: 8, wins: 3, mostPlayed: { name: 'Atraxa Deck', slug: 'a' } } })
    );
    renderProfile();
    expect(await screen.findByText('Game record')).toBeTruthy();
    expect(screen.getByText('38%')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Atraxa Deck' }).getAttribute('href')).toBe('/d/a');
  });

  it('shows Follow to a visitor with a Friends mark, and neither on your own profile', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich({ viewerIsFriend: true }));
    const first = renderProfile();
    expect(await screen.findByRole('button', { name: 'Follow alice' })).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
    // A status label, never a control: it must not be a button or a link.
    expect(screen.queryByRole('button', { name: 'Friends' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Friends' })).toBeNull();
    first.unmount();

    fetchPublicProfileMock.mockResolvedValue(rich({ isOwner: true }));
    renderProfile();
    await screen.findByRole('list', { name: 'Profile stats' });
    expect(screen.queryByRole('button', { name: 'Follow alice' })).toBeNull();
  });

  it('shows nothing but identity on a moderator-hidden profile', async () => {
    fetchPublicProfileMock.mockResolvedValue(rich({ isOwner: true, moderationHidden: true }));
    renderProfile();
    await screen.findByText(/hidden by a moderator/);
    expect(screen.queryByRole('list', { name: 'Profile stats' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Colors' })).toBeNull();
    expect(document.querySelector('.public-profile-banner')).toBeNull();
  });
});
