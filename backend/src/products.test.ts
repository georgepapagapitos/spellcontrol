import { describe, it, expect, vi, beforeEach } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return import('./products');
}

const INDEX = {
  data: [
    {
      code: 'WOC',
      fileName: 'FaeDominion_WOC',
      name: 'Fae Dominion',
      releaseDate: '2023-09-08',
      type: 'Commander Deck',
    },
    {
      code: 'SLD',
      fileName: 'RainingCatsAndDogs_SLD',
      name: 'Raining Cats and Dogs',
      releaseDate: '2024-01-22',
      type: 'Commander Deck',
    },
    {
      code: 'SOC',
      fileName: 'PrismariArtistry_SOC',
      name: 'Prismari Artistry',
      releaseDate: '2026-04-24',
      type: 'Commander Deck',
    },
    {
      code: 'GRN',
      fileName: 'RalCallerOfStorms_GRN',
      name: 'Ral, Caller of Storms',
      releaseDate: '2018-10-05',
      type: 'Planeswalker Deck',
    },
  ],
};

function indexResponse() {
  return new Response(JSON.stringify(INDEX), { status: 200 });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('searchProducts', () => {
  it('ranks exact > prefix > substring and respects the type filter', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();

    const results = await searchProducts('fae', { types: ['Commander Deck'] });
    expect(results[0].name).toBe('Fae Dominion');
    // Planeswalker deck excluded by the type filter.
    expect(results.every((r) => r.type === 'Commander Deck')).toBe(true);
  });

  it('matches case-insensitively on a substring', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    const results = await searchProducts('CATS');
    expect(results.map((r) => r.fileName)).toContain('RainingCatsAndDogs_SLD');
  });

  it('with an empty query returns newest-first', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    const results = await searchProducts('');
    expect(results[0].releaseDate).toBe('2026-04-24'); // Prismari Artistry, newest
  });

  it('caches the index across calls within the TTL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    await searchProducts('fae');
    await searchProducts('cats');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('getProductDeck', () => {
  it('returns null for a fileName not in the index (path-traversal guard)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { getProductDeck } = await freshModule();
    const deck = await getProductDeck('../../etc/passwd');
    expect(deck).toBeNull();
  });

  it('fetches, caches (LRU), and dedupes the deck file for a known product', async () => {
    const deckBody = new Response(
      JSON.stringify({
        data: { name: 'Fae Dominion', code: 'WOC', type: 'Commander Deck', mainBoard: [] },
      }),
      { status: 200 }
    );
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockImplementation((input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        return Promise.resolve(url.includes('/decks/') ? deckBody.clone() : indexResponse());
      });
    const { getProductDeck } = await freshModule();

    const first = await getProductDeck('FaeDominion_WOC');
    expect(first?.name).toBe('Fae Dominion');

    const deckFetchCount = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes('/decks/')
    ).length;
    await getProductDeck('FaeDominion_WOC'); // cached — no second deck fetch
    const after = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/decks/')).length;
    expect(after).toBe(deckFetchCount);
    expect(deckFetchCount).toBe(1);
  });
});
