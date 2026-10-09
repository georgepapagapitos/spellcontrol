import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getCardsByNames = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByNames: (n: string[]) => getCardsByNames(n),
}));

// The overall popular list carries no colors, so they are looked up on Scryfall.
// A failed lookup must read as "unknown", never as colorless, and must not be
// cached for 30 minutes.
const body = {
  kind: 'commanders',
  period: 'year',
  colors: '',
  type: null,
  entries: [
    { rank: 1, name: 'Atraxa', scryfallId: null, numDecks: 9, potentialDecks: null, salt: null },
    { rank: 2, name: 'Karn', scryfallId: null, numDecks: 5, potentialDecks: null, salt: null },
  ],
  fetchedAt: 0,
  stale: false,
  sourceUrl: 'https://edhrec.com/commanders',
};

describe('fetchTopCommanders color backfill', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let fetchTopCommanders: typeof import('./client').fetchTopCommanders;
  beforeEach(async () => {
    // A fresh module per test: the 30-minute cache is module state.
    vi.resetModules();
    ({ fetchTopCommanders } = await import('./client'));
    getCardsByNames.mockReset();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: '200',
      headers: { get: () => null },
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('marks identities unknown when the lookup fails, and does not cache the result', async () => {
    getCardsByNames.mockRejectedValue(new Error('429'));
    const first = await fetchTopCommanders([]);
    expect(first.every((c) => c.colorsUnknown === true)).toBe(true);

    getCardsByNames.mockResolvedValue(
      new Map([
        ['Atraxa', { color_identity: ['W', 'U', 'B', 'G'] }],
        ['Karn', { color_identity: [] }],
      ])
    );
    const second = await fetchTopCommanders([]);
    expect(getCardsByNames).toHaveBeenCalledTimes(2); // not served from the 30-minute cache
    expect(second[0].colorIdentity).toEqual(['W', 'U', 'B', 'G']);
    expect(second[0].colorsUnknown).toBeUndefined();
    // A resolved colorless commander is known, not unknown.
    expect(second[1].colorIdentity).toEqual([]);
    expect(second[1].colorsUnknown).toBeUndefined();

    await fetchTopCommanders([]);
    expect(getCardsByNames).toHaveBeenCalledTimes(2); // the complete list is cached
  });

  it('marks only the names Scryfall did not return', async () => {
    getCardsByNames.mockResolvedValue(new Map([['Karn', { color_identity: [] }]]));
    const list = await fetchTopCommanders([]);
    expect(list.map((c) => c.colorsUnknown)).toEqual([true, undefined]);
  });
});
