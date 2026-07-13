import { describe, it, expect, vi, beforeEach } from 'vitest';

async function freshModule() {
  vi.resetModules();
  return import('./sets');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getSetMap', () => {
  it('returns an upper-cased, normalized map keyed by set code', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            {
              code: 'cmr',
              name: 'Commander Legends',
              icon_svg_uri: 'a.svg',
              released_at: '2020-11-20',
              card_count: 361,
            },
            {
              code: 'rna',
              name: 'Ravnica Allegiance',
              icon_svg_uri: 'b.svg',
              released_at: '2019-01-25',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const { getSetMap } = await freshModule();
    const map = await getSetMap();
    expect(map.CMR.name).toBe('Commander Legends');
    expect(map.CMR.iconSvgUri).toBe('a.svg');
    expect(map.CMR.releasedAt).toBe('2020-11-20');
    expect(map.CMR.cardCount).toBe(361);
    expect(map.RNA.code).toBe('RNA');
    expect(map.RNA.cardCount).toBe(0);
  });

  it('caches the response across calls within the TTL', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })
      );
    const { getSetMap } = await freshModule();
    await getSetMap();
    await getSetMap();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight request across concurrent callers', async () => {
    let resolveFetch!: (v: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveFetch = r;
    });
    const fetchSpy = vi.spyOn(global, 'fetch').mockReturnValue(pending);
    const { getSetMap } = await freshModule();
    const a = getSetMap();
    const b = getSetMap();
    resolveFetch(new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }));
    await Promise.all([a, b]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws and clears in-flight on a non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const { getSetMap } = await freshModule();
    await expect(getSetMap()).rejects.toThrow(/HTTP 500/);
  });
});

function searchPage(cards: unknown[], nextPage?: string) {
  return new Response(
    JSON.stringify({ data: cards, has_more: Boolean(nextPage), next_page: nextPage }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

const RAW_CARD = {
  id: 'abc',
  oracle_id: 'o-abc',
  name: 'Lightning Bolt',
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  cmc: 1,
  type_line: 'Instant',
  mana_cost: '{R}',
  finishes: ['nonfoil'],
  prices: { usd: '100.00', usd_foil: null, usd_etched: null, eur: '90.00' },
  image_uris: { small: 's.jpg', normal: 'n.jpg', large: 'l.jpg', png: 'p.png' },
  object: 'card',
  booster: true,
  games: ['paper'],
};

describe('getSetCards', () => {
  it('follows next_page and trims cards to the projected fields', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(searchPage([RAW_CARD], 'https://api.scryfall.com/page2'))
      .mockResolvedValueOnce(
        searchPage([{ ...RAW_CARD, id: 'def', collector_number: '162', name: 'Other' }])
      );
    const { getSetCards } = await freshModule();
    const cards = await getSetCards('LEA');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe('https://api.scryfall.com/page2');
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe('Lightning Bolt');
    expect(cards[0].collector_number).toBe('161');
    // Trimmed: passthrough Scryfall noise fields are dropped.
    expect(cards[0]).not.toHaveProperty('object');
    expect(cards[0]).not.toHaveProperty('booster');
    expect(cards[0].image_uris).toEqual({ small: 's.jpg', normal: 'n.jpg', large: 'l.jpg' });
    expect(cards[0].prices).toEqual({ usd: '100.00', usd_foil: null, usd_etched: null });
  });

  it('requests every printing and variation of the set', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(searchPage([RAW_CARD]));
    const { getSetCards } = await freshModule();
    await getSetCards('lea');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('q=e%3Alea');
    expect(url).toContain('unique=prints');
    expect(url).toContain('include_extras=true');
    expect(url).toContain('include_variations=true');
  });

  it('caches per set code within the TTL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(searchPage([RAW_CARD]));
    const { getSetCards } = await freshModule();
    await getSetCards('lea');
    await getSetCards('LEA');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws SetNotFoundError on a 404 (unknown set)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const { getSetCards, SetNotFoundError } = await freshModule();
    await expect(getSetCards('zzz')).rejects.toBeInstanceOf(SetNotFoundError);
  });

  it('throws and clears in-flight on a non-OK response', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(searchPage([RAW_CARD]));
    const { getSetCards } = await freshModule();
    await expect(getSetCards('lea')).rejects.toThrow(/HTTP 500/);
    // The failed attempt must not poison the cache — a retry refetches.
    const cards = await getSetCards('lea');
    expect(cards).toHaveLength(1);
  });
});
