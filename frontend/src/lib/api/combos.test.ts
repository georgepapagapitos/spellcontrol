import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchCombos, getCombo, fetchOracleIds, fetchComboBracketTags } from './combos';
import { ensureCombosCached, matchCombosLocal } from '../offline';

// matchCombos prefers client-side matching; mock the offline layer so we can
// drive both the local path and the server fallback deterministically.
vi.mock('../offline', () => ({
  ensureCombosCached: vi.fn(),
  matchCombosLocal: vi.fn(),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Default: dataset can't be cached → exercise the server fallback path.
  vi.mocked(ensureCombosCached).mockResolvedValue(false);
  vi.mocked(matchCombosLocal).mockReset();
});

describe('timeout + abort handling', () => {
  it('throws a friendly error when the request is aborted (timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    );
    await expect(matchCombos({ ownedOracleIds: [] })).rejects.toThrow(/taking too long/i);
  });

  it('throws a friendly error when the network is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(matchCombos({ ownedOracleIds: [] })).rejects.toThrow(/couldn't reach combos/i);
  });
});

describe('matchCombos', () => {
  it('POSTs the request body and returns the parsed match buckets', async () => {
    const empty = { inDeck: [], oneAway: [], almostInCollection: [], almostInCollectionTotal: 0 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(empty));

    const result = await matchCombos({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a'],
      format: 'commander',
    });

    // E212: tagged with the matcher that produced it — this went through the
    // capped server fallback, not the full local dataset.
    expect(result).toEqual({ ...empty, source: 'server' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/combos/match',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a'],
      format: 'commander',
    });
  });

  it('throws on a non-OK response with the server-provided error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Authentication required.' }, { status: 401 })
    );
    await expect(matchCombos({ ownedOracleIds: [] })).rejects.toThrow(/Authentication required/);
  });
});

describe('matchCombos (client-side)', () => {
  it('falls back to the server matcher when the local matcher throws', async () => {
    // A browser-storage failure (Firefox's IndexedDB response cap, a wedged
    // database) must not surface its raw message on the deck panel — it is the
    // "dataset couldn't be used" case the capped server fallback exists for.
    vi.mocked(ensureCombosCached).mockResolvedValue(true);
    vi.mocked(matchCombosLocal).mockRejectedValue(
      new Error('The serialized value is too large (size=262901152 bytes, max=257949696 bytes).')
    );
    const empty = { inDeck: [], oneAway: [], almostInCollection: [], almostInCollectionTotal: 0 };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(empty));

    const result = await matchCombos({ ownedOracleIds: ['a'], format: 'commander' });

    expect(result).toEqual({ ...empty, source: 'server' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/combos/match', expect.anything());
  });

  it('matches locally against the cached dataset and never calls the server', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(true);
    const local = { inDeck: [], oneAway: [], almostInCollection: [], almostInCollectionTotal: 0 };
    vi.mocked(matchCombosLocal).mockResolvedValue(local);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await matchCombos({
      ownedOracleIds: ['a'],
      deckOracleIds: ['a'],
      format: 'commander',
    });

    // E212: tagged 'local' — this is the full-dataset answer, cacheable and
    // presentable as final.
    expect(result).toEqual({ ...local, source: 'local' });
    expect(matchCombosLocal).toHaveBeenCalledWith({
      ownedOracleIds: ['a'],
      deckOracleIds: ['a'],
      format: 'commander',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('matchCombos (server path, the default)', () => {
  const body = { inDeck: [], oneAway: [], almostInCollection: [], almostInCollectionTotal: 0 };

  it('goes to the server without ever touching the dataset when it is not cached', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(false);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...body, truncated: false }));

    const result = await matchCombos({ ownedOracleIds: ['a'], deckOracleIds: ['b'] });

    expect(matchCombosLocal).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/combos/match',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({ ...body, truncated: false, source: 'server' });
  });

  it('passes the server truncation flag through', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...body, truncated: true }));

    expect((await matchCombos({ ownedOracleIds: ['a'] })).truncated).toBe(true);
  });

  it('takes the server path when the local matcher throws', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(true);
    vi.mocked(matchCombosLocal).mockRejectedValue(new Error('IndexedDB is not available.'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...body, truncated: false }));

    expect((await matchCombos({ ownedOracleIds: ['a'] })).source).toBe('server');
  });

  it('surfaces a server error as authored copy, not the raw exception', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(false);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(matchCombos({ ownedOracleIds: ['a'] })).rejects.toThrow(
      /couldn't reach combos right now/i
    );
  });
});

describe('fetchComboBracketTags', () => {
  it('skips the request for no ids', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect((await fetchComboBracketTags([])).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the ids and returns a map of tags', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ tags: { '1-2': 'R', '3-4': null } }));

    const tags = await fetchComboBracketTags(['1-2', '3-4']);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/combos/bracket-tags',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['1-2', '3-4'] }) })
    );
    expect(tags.get('1-2')).toBe('R');
    expect(tags.get('3-4')).toBeNull();
  });
});

describe('getCombo', () => {
  it('GETs /api/combos/:id with URL-encoded id and returns the body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'combo with space' }));

    await getCombo('combo with space');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/combos/combo%20with%20space',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Combo not found.' }, { status: 404 })
    );
    await expect(getCombo('nope')).rejects.toThrow(/Combo not found/);
  });
});

describe('fetchOracleIds', () => {
  it('returns an empty map without calling fetch when given no ids', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchOracleIds([]);
    expect(result).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the scryfallIds list and returns the resolved oracleIds map', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ oracleIds: { abc: 'oracle-1' } }));

    const result = await fetchOracleIds(['abc', 'def']);

    expect(result).toEqual({ abc: 'oracle-1' });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ scryfallIds: ['abc', 'def'] });
  });

  it('throws on a non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Body must be { scryfallIds: string[] }.' }, { status: 400 })
    );
    await expect(fetchOracleIds(['x'])).rejects.toThrow(/scryfallIds/);
  });
});
