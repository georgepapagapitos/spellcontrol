import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DisplayNameRequiredError,
  getPublication,
  listMyPublications,
  publicationUrl,
  publishDeck,
  unpublishDeck,
  type Publication,
  type OwnedPublication,
} from './publications-client';
import { isNativePlatform } from './platform';

vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => false) }));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const PUB: Publication = {
  slug: 'korvold-treasure',
  url: 'https://spellcontrol.com/d/korvold-treasure',
  publishedAt: 1,
  updatedAt: 1,
  unpublishedAt: null,
  viewCount: 4,
  copyCount: 1,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getPublication', () => {
  it('GETs the deck publish status and returns the publication', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ publication: PUB }));
    const out = await getPublication('d1');
    expect(out).toEqual(PUB);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/publications/decks/d1',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('resolves null when never published (still a 200)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ publication: null }));
    expect(await getPublication('d1')).toBeNull();
  });

  it('throws with the server error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope' }, { status: 500 })
    );
    await expect(getPublication('d1')).rejects.toThrow(/nope/);
  });
});

describe('listMyPublications', () => {
  it('GETs the caller-wide list and returns the publications array', async () => {
    const rows: OwnedPublication[] = [
      { deckId: 'd1', slug: 'korvold-treasure', unpublishedAt: null, viewCount: 4, copyCount: 1 },
      { deckId: 'd2', slug: 'old-deck', unpublishedAt: 12345, viewCount: 2, copyCount: 0 },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ publications: rows }));
    const out = await listMyPublications();
    expect(out).toEqual(rows);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/publications/decks',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('resolves an empty array when nothing has ever been published', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ publications: [] }));
    expect(await listMyPublications()).toEqual([]);
  });

  it('throws with the server error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope' }, { status: 500 })
    );
    await expect(listMyPublications()).rejects.toThrow(/nope/);
  });
});

describe('publishDeck', () => {
  it('POSTs and returns the publication', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ publication: PUB }, { status: 201 }));
    const out = await publishDeck('d1');
    expect(out).toEqual(PUB);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/publications/decks/d1',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
  });

  it('throws DisplayNameRequiredError specifically on a display_name_required 400', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { error: 'display_name_required', message: 'Set a display name before publishing.' },
        { status: 400 }
      )
    );
    await expect(publishDeck('d1')).rejects.toBeInstanceOf(DisplayNameRequiredError);
  });

  it('throws a plain Error (not DisplayNameRequiredError) for any other failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'This deck needs a name before it can be published.' }, { status: 400 })
    );
    const err = await publishDeck('d1').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DisplayNameRequiredError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/needs a name/);
  });
});

describe('unpublishDeck', () => {
  it('DELETEs the publication', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await unpublishDeck('d1');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/publications/decks/d1',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' })
    );
  });

  it('no-ops on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(unpublishDeck('d1')).resolves.toBeUndefined();
  });

  it('throws on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope' }, { status: 500 })
    );
    await expect(unpublishDeck('d1')).rejects.toThrow(/nope/);
  });
});

describe('publicationUrl', () => {
  beforeEach(() => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
  });

  it('builds an absolute URL using window.location.origin on web', () => {
    expect(publicationUrl('korvold-treasure')).toMatch(/\/d\/korvold-treasure$/);
  });

  it('uses the public web origin on native (WebView origin is unusable)', () => {
    vi.mocked(isNativePlatform).mockReturnValue(true);
    expect(publicationUrl('korvold-treasure')).toBe('https://spellcontrol.com/d/korvold-treasure');
  });
});
