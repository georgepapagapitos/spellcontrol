import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchCombos, getCombo, fetchOracleIds } from './combos';
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
    await expect(matchCombos({ ownedOracleIds: [] })).rejects.toThrow(/timed out/i);
  });

  it('throws a friendly error when the network is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(matchCombos({ ownedOracleIds: [] })).rejects.toThrow(/not responding/i);
  });
});

describe('matchCombos', () => {
  it('POSTs the request body and returns the parsed match buckets', async () => {
    const empty = { inDeck: [], oneAway: [], almostInCollection: [] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(empty));

    const result = await matchCombos({
      ownedOracleIds: ['a', 'b'],
      deckOracleIds: ['a'],
      format: 'commander',
    });

    expect(result).toEqual(empty);
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
  it('matches locally against the cached dataset and never calls the server', async () => {
    vi.mocked(ensureCombosCached).mockResolvedValue(true);
    const local = { inDeck: [], oneAway: [], almostInCollection: [] };
    vi.mocked(matchCombosLocal).mockResolvedValue(local);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await matchCombos({
      ownedOracleIds: ['a'],
      deckOracleIds: ['a'],
      format: 'commander',
    });

    expect(result).toBe(local);
    expect(matchCombosLocal).toHaveBeenCalledWith({
      ownedOracleIds: ['a'],
      deckOracleIds: ['a'],
      format: 'commander',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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
