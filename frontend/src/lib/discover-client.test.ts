import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listDiscoverDecks, searchCommanders } from './discover-client';
import { NO_DISCOVER_FILTERS } from './discover-filters';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function fetchedUrl(fetchSpy: ReturnType<typeof vi.spyOn>): string {
  return fetchSpy.mock.calls[0][0] as string;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('listDiscoverDecks', () => {
  it('sends only sort=newest with no other params', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ decks: [], page: 1, hasMore: false }));
    await listDiscoverDecks({});
    expect(fetchedUrl(fetchSpy)).toBe('/api/discover/decks?sort=newest');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('includes page only when given', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ decks: [], page: 2, hasMore: false }));
    await listDiscoverDecks({ page: 2 });
    const url = new URL(fetchedUrl(fetchSpy), 'http://x');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('sends the requested sort key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ decks: [], page: 1, hasMore: false }));
    await listDiscoverDecks({ sort: 'most-copied' });
    const url = new URL(fetchedUrl(fetchSpy), 'http://x');
    expect(url.searchParams.get('sort')).toBe('most-copied');
  });

  it('includes every filter dimension when present', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ decks: [], page: 1, hasMore: false }));
    await listDiscoverDecks({
      ...NO_DISCOVER_FILTERS,
      commander: "Atraxa, Praetors' Voice",
      format: 'commander',
      brackets: [2, 4],
      colors: ['W', 'U'],
      budget: '50to150',
    });
    const url = new URL(fetchedUrl(fetchSpy), 'http://x');
    expect(url.searchParams.get('commander')).toBe("Atraxa, Praetors' Voice");
    expect(url.searchParams.get('format')).toBe('commander');
    expect(url.searchParams.get('bracket')).toBe('2,4');
    expect(url.searchParams.get('colors')).toBe('W,U');
    expect(url.searchParams.get('budget')).toBe('50to150');
  });

  it('omits empty-array/null filter dimensions rather than sending blank params', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ decks: [], page: 1, hasMore: false }));
    await listDiscoverDecks({ ...NO_DISCOVER_FILTERS });
    const url = new URL(fetchedUrl(fetchSpy), 'http://x');
    expect(url.searchParams.has('commander')).toBe(false);
    expect(url.searchParams.has('format')).toBe(false);
    expect(url.searchParams.has('bracket')).toBe(false);
    expect(url.searchParams.has('colors')).toBe(false);
    expect(url.searchParams.has('budget')).toBe(false);
  });

  it('resolves with the parsed page result on success', async () => {
    const result = { decks: [{ slug: 'a' }], page: 1, hasMore: true };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(result));
    await expect(listDiscoverDecks({})).resolves.toEqual(result);
  });

  it('throws the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Something broke.' }, { status: 500 })
    );
    await expect(listDiscoverDecks({})).rejects.toThrow('Something broke.');
  });

  it('falls back to a generic message when the error body is unparsable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(listDiscoverDecks({})).rejects.toThrow('Failed to load public decks.');
  });
});

describe('searchCommanders', () => {
  it('URL-encodes the query and includes credentials', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ commanders: ['Korvold, Fae-Cursed King'] }));
    await searchCommanders('korvold & co');
    expect(fetchedUrl(fetchSpy)).toBe('/api/discover/decks/commanders?q=korvold%20%26%20co');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('resolves with the commander name list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ commanders: ['Alpha', 'Beta'] })
    );
    await expect(searchCommanders('a')).resolves.toEqual(['Alpha', 'Beta']);
  });

  it('throws the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'q must be 40 characters or fewer.' }, { status: 400 })
    );
    await expect(searchCommanders('x'.repeat(41))).rejects.toThrow(
      'q must be 40 characters or fewer.'
    );
  });

  it('falls back to a generic message when the error body is unparsable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));
    await expect(searchCommanders('a')).rejects.toThrow('Failed to search commanders.');
  });
});
