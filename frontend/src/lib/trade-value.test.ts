import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchFloorPrice, splitSideValue, __resetFloorCache } from './trade-value';
import { setPrices, _resetForTests } from './card-prices';
import type { TradeCard } from './trades-client';

function card(over: Partial<TradeCard> & { name: string }): TradeCard {
  return { oracleId: `o-${over.name}`, quantity: 1, copies: [], ...over };
}

describe('splitSideValue', () => {
  beforeEach(() => {
    _resetForTests();
    setPrices({
      'scry-a': { usd: 10, eur: 8, pricedAt: Date.now() },
      'scry-b:foil': { usd: 25, eur: 20, pricedAt: Date.now() },
    });
  });

  it('prices each copy at ITS OWN printing and finish', () => {
    const { exact, needFloor } = splitSideValue([
      card({
        name: 'Sol Ring',
        quantity: 2,
        copies: [
          { scryfallId: 'scry-a', finish: 'nonfoil' },
          { scryfallId: 'scry-b', finish: 'foil' },
        ],
      }),
    ]);
    // Not 2 × either price — the whole point is that the two copies differ.
    expect(exact).toBe(35);
    expect(needFloor).toEqual([]);
  });

  it('defers an oracle-level card to the floor instead of counting it as 0', () => {
    const { exact, needFloor } = splitSideValue([card({ name: 'Rhystic Study' })]);
    expect(exact).toBe(0);
    expect(needFloor.map((c) => c.name)).toEqual(['Rhystic Study']);
  });

  it('defers an UNCACHED printing rather than summing it as free', () => {
    // The bug this pins: the cache only holds printings the viewer has owned,
    // so the side you're RECEIVING is usually absent from it. Summing those as
    // 0 rendered "You get $0.00" on a real offer.
    const { exact, needFloor } = splitSideValue([
      card({ name: 'Mystery', copies: [{ scryfallId: 'not-cached', finish: 'nonfoil' }] }),
    ]);
    expect(exact).toBe(0);
    expect(needFloor.map((c) => c.name)).toEqual(['Mystery']);
  });

  it('does not half-count a card whose copies are only partly priced', () => {
    const { exact, needFloor } = splitSideValue([
      card({
        name: 'Half',
        quantity: 2,
        copies: [
          { scryfallId: 'scry-a', finish: 'nonfoil' },
          { scryfallId: 'not-cached', finish: 'nonfoil' },
        ],
      }),
    ]);
    expect(exact).toBe(0);
    expect(needFloor.map((c) => c.name)).toEqual(['Half']);
  });
});

describe('fetchFloorPrice', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetFloorCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function respond(prices: unknown) {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ card: { prices } }) });
  }

  it('reads the cheapest printing price', async () => {
    respond({ usd: '12.34' });
    expect(await fetchFloorPrice('Rhystic Study')).toBe(12.34);
  });

  it('never reads a null price as free — Number(null) is 0', async () => {
    // The exact trap the backend's own reducer documents: a 0 here would make
    // an unpriced card look free and understate the ask side of a trade.
    respond({ usd: null, usd_foil: '4.00' });
    expect(await fetchFloorPrice('Weird Card')).toBe(4);

    __resetFloorCache();
    respond({ usd: null, usd_foil: null });
    expect(await fetchFloorPrice('Unpriced')).toBeNull();
  });

  it('returns null (never 0) on a cache miss or a failure', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await fetchFloorPrice('Missing')).toBeNull();

    __resetFloorCache();
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await fetchFloorPrice('Offline')).toBeNull();
  });

  it('caches a null answer so an unpriceable card is not refetched forever', async () => {
    respond({ usd: null });
    expect(await fetchFloorPrice('Nope')).toBeNull();
    expect(await fetchFloorPrice('Nope')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
