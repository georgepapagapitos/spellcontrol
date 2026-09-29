import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchBrewerRails,
  fetchFollowing,
  followUser,
  searchBrewers,
  unfollowUser,
} from './brewers-client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const CARD = {
  username: 'ana',
  displayName: 'Ana',
  avatarImageUrl: null,
  bannerImage: null,
  deckCount: 2,
  followerCount: 3,
  topColors: ['U'],
  topCommander: null,
  joinedAt: 1,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchBrewerRails', () => {
  it('reads the rails with the session cookie', async () => {
    const rails = {
      newest: [CARD],
      mostLiked: [],
      mostFollowed: [],
      sharedCommanders: [],
      spotlight: null,
    };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(rails));
    await expect(fetchBrewerRails()).resolves.toEqual(rails);
    expect(spy).toHaveBeenCalledWith(
      '/api/public/brewers/rails',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws the server message, else a fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'Nope.' }, { status: 500 })
    );
    await expect(fetchBrewerRails()).rejects.toThrow('Nope.');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('x', { status: 500 }));
    await expect(fetchBrewerRails()).rejects.toThrow(/Couldn't load brewers/);
  });
});

describe('searchBrewers', () => {
  it('skips the request under two characters', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(searchBrewers(' a ')).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the trimmed query and the limit, and unwraps the list', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ brewers: [CARD] }));
    await expect(searchBrewers(' an a ', 5)).resolves.toEqual([CARD]);
    const url = new URL(spy.mock.calls[0][0] as string, 'http://x');
    expect(url.pathname).toBe('/api/public/brewers');
    expect(url.searchParams.get('q')).toBe('an a');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('omits limit when not given and throws on failure', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ brewers: [] }));
    await searchBrewers('ana');
    expect(new URL(spy.mock.calls[0][0] as string, 'http://x').searchParams.has('limit')).toBe(
      false
    );
    spy.mockResolvedValueOnce(new Response('x', { status: 429 }));
    await expect(searchBrewers('ana')).rejects.toThrow(/Couldn't search/);
  });
});

describe('followUser / unfollowUser', () => {
  it('POSTs and DELETEs the encoded username', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ following: true, followerCount: 4 }))
      .mockResolvedValueOnce(jsonResponse({ following: false, followerCount: 3 }));
    await expect(followUser('a b')).resolves.toEqual({ following: true, followerCount: 4 });
    await expect(unfollowUser('ana')).resolves.toEqual({ following: false, followerCount: 3 });
    expect(spy.mock.calls[0][0]).toBe('/api/follows/a%20b');
    expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(spy.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('surfaces the server message, else a fallback', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: "You can't follow yourself." }, { status: 400 }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }))
      .mockResolvedValueOnce(new Response('x', { status: 500 }));
    await expect(followUser('me')).rejects.toThrow("You can't follow yourself.");
    await expect(followUser('ana')).rejects.toThrow(/Couldn't follow/);
    await expect(unfollowUser('ana')).rejects.toThrow(/Couldn't unfollow/);
  });
});

describe('fetchFollowing', () => {
  it('unwraps the list, and throws on failure', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ brewers: [CARD] }))
      .mockResolvedValueOnce(new Response('x', { status: 401 }));
    await expect(fetchFollowing()).resolves.toEqual([CARD]);
    await expect(fetchFollowing()).rejects.toThrow(/who you follow/);
    expect(spy.mock.calls[0][0]).toBe('/api/follows/following');
  });
});
