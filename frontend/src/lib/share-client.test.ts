import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createShare,
  fetchPublicShare,
  listShares,
  revokeShare,
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

  it('throws ShareNotFoundError on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchPublicShare('tok')).rejects.toBeInstanceOf(ShareNotFoundError);
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
