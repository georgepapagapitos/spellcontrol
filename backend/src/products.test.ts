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
    const results = await searchProducts('', { types: ['Planeswalker Deck', 'Commander Deck'] });
    // Odds and Ends (pending, 2026-09-28) is newest, then Prismari Artistry.
    expect(results.map((r) => r.releaseDate).slice(0, 2)).toEqual(['2026-09-28', '2026-04-24']);
  });

  // E577: MTGJSON's DeckList had no Odds and Ends on 2026-10-07, nine days
  // after it shipped, so the search found nothing under any filter.
  it('finds a shipped product MTGJSON has not listed yet, under Commander and Secret Lair', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    for (const type of ['Commander Deck', 'Secret Lair Drop']) {
      const results = await searchProducts('odds and ends', { types: [type] });
      expect(results.map((r) => r.fileName)).toEqual(['pending-OddsAndEnds_SLD']);
    }
  });

  it('the Secret Lair filter includes Secret Lair commander decks', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    const results = await searchProducts('cats', { types: ['Secret Lair Drop'] });
    expect(results.map((r) => r.fileName)).toContain('RainingCatsAndDogs_SLD');
  });

  it('drops a pending product once MTGJSON lists it', async () => {
    const listed = {
      data: [
        ...INDEX.data,
        {
          code: 'SLD',
          fileName: 'SecretLairCommanderDeckOddsAndEnds_SLD',
          name: 'Secret Lair Commander Deck: Odds and Ends',
          releaseDate: '2026-09-28',
          type: 'Commander Deck',
        },
      ],
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(listed), { status: 200 })
    );
    const { searchProducts } = await freshModule();
    const results = await searchProducts('odds and ends');
    expect(results.map((r) => r.fileName)).toEqual(['SecretLairCommanderDeckOddsAndEnds_SLD']);
  });

  it('caches the index across calls within the TTL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { searchProducts } = await freshModule();
    await searchProducts('fae');
    await searchProducts('cats');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('commander summary cache', () => {
  it('distinguishes uncached (undefined) from resolved-no-commander (null)', async () => {
    const { getCachedCommanderSummary, setCachedCommanderSummary } = await freshModule();
    expect(getCachedCommanderSummary('Unknown_X')).toBeUndefined();

    setCachedCommanderSummary('NonCommander_Y', null);
    expect(getCachedCommanderSummary('NonCommander_Y')).toBeNull();

    const summary = { name: 'Zada, Hedron Grinder', colorIdentity: ['R'], image: 'z.png' };
    setCachedCommanderSummary('GoblinStorm_SLD', summary);
    expect(getCachedCommanderSummary('GoblinStorm_SLD')).toEqual(summary);
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

  it('serves a pending product from the repo, the commander and its foils pinned', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(indexResponse());
    const { getProductDeck } = await freshModule();
    const deck = await getProductDeck('pending-OddsAndEnds_SLD');
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes('/decks/'))).toBe(false);
    expect(deck?.commander).toEqual([
      {
        count: 1,
        name: 'Yennett, Cryptic Sovereign',
        setCode: 'SLD',
        number: '2121',
        isFoil: true,
      },
    ]);
    const main = deck?.mainBoard ?? [];
    expect(main.reduce((n, c) => n + (c.count ?? 1), 0)).toBe(99);
    // The 11 new-art foils, then the 12 foil Oddlands basics (4 each).
    expect(main.filter((c) => c.setCode === 'SLD').map((c) => c.number)).toEqual([
      ...Array.from({ length: 11 }, (_, i) => String(2122 + i)),
      '2116',
      '2117',
      '2118',
    ]);
    expect(main.filter((c) => c.number && Number(c.number) <= 2118).map((c) => c.count)).toEqual([
      4, 4, 4,
    ]);
    expect(main.filter((c) => c.setCode === 'SLD').every((c) => c.isFoil)).toBe(true);
  });
});
