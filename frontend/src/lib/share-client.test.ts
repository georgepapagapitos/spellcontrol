import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShare,
  fetchPublicShare,
  getFriendShares,
  listShares,
  revokeShare,
  ShareAuthRequiredError,
  ShareNotFoundError,
  shareUrl,
} from './share-client';
import { isNativePlatform } from './platform';

vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => false) }));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createShare', () => {
  it('POSTs kind + resourceId and returns the share row', async () => {
    const row = {
      token: 'abc',
      userId: 'u1',
      kind: 'deck' as const,
      resourceId: 'd1',
      createdAt: 1,
      revokedAt: null,
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ share: row }, { status: 201 }));
    const out = await createShare({ kind: 'deck', resourceId: 'd1' });
    expect(out).toEqual(row);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/shares',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  it('forwards an audience when given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ share: {} }, { status: 201 }));
    await createShare({ kind: 'cube', resourceId: 'c1', audience: 'friends' });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ kind: 'cube', resourceId: 'c1', audience: 'friends' });
  });

  it('throws with the server error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'bad kind' }, { status: 400 })
    );
    await expect(createShare({ kind: 'collection' })).rejects.toThrow(/bad kind/);
  });
});

describe('listShares', () => {
  it('returns the list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ shares: [] }));
    expect(await listShares()).toEqual([]);
  });
});

describe('revokeShare', () => {
  it('no-ops on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(revokeShare('x')).resolves.toBeUndefined();
  });

  it('throws on non-404 errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope' }, { status: 500 })
    );
    await expect(revokeShare('x')).rejects.toThrow(/nope/);
  });
});

describe('fetchPublicShare', () => {
  it('returns the parsed payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ kind: 'collection', data: { ownerUsername: 'alice', cards: [] } })
    );
    const out = await fetchPublicShare('tok');
    expect(out.kind).toBe('collection');
  });

  it('sends credentials so friends shares get the session cookie', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ kind: 'collection', data: {} }));
    await fetchPublicShare('tok');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/shares/public/tok'),
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws ShareNotFoundError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchPublicShare('tok')).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it('throws ShareAuthRequiredError on 401 (friends-only share, no auth)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 401 }));
    await expect(fetchPublicShare('tok')).rejects.toBeInstanceOf(ShareAuthRequiredError);
  });
});

describe('getFriendShares', () => {
  it('returns the owner username + shares', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ownerUsername: 'bob', shares: [{ token: 't', kind: 'deck', label: 'X' }] })
    );
    const out = await getFriendShares('bob-id');
    expect(out.ownerUsername).toBe('bob');
    expect(out.shares).toHaveLength(1);
  });

  it('throws on a non-ok response (e.g. 403 not friends)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not friends.' }, { status: 403 })
    );
    await expect(getFriendShares('x')).rejects.toThrow(/Not friends/);
  });
});

describe('shareUrl', () => {
  beforeEach(() => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
  });

  it('builds an absolute URL using window.location.origin on web', () => {
    expect(shareUrl('abc123')).toMatch(/\/s\/abc123$/);
  });

  it('uses the public web origin on native (WebView origin is unusable)', () => {
    vi.mocked(isNativePlatform).mockReturnValue(true);
    expect(shareUrl('abc123')).toBe('https://spellcontrol.com/s/abc123');
  });
});
