import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveCards,
  fetchCardsByIds,
  fetchPrintings,
  identifyCardByName,
  getCardBySetAndNumber,
} from './scryfall';
import type { ScryfallCache } from './cache';
import type { ScryfallCard } from './types';
import type { ImportRow } from './parsers/types';

function card(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    name: 'Sol Ring',
    rarity: 'uncommon',
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '1',
    ...overrides,
  };
}

function fakeCache(initial: ScryfallCard[] = []): ScryfallCache {
  const map = new Map<string, ScryfallCard>();
  for (const c of initial) map.set(c.id, c);
  return {
    getMany: vi.fn((ids: string[]) => {
      const out = new Map<string, ScryfallCard>();
      for (const id of ids) {
        const hit = map.get(id);
        if (hit) out.set(id, hit);
      }
      return out;
    }),
    setMany: vi.fn((cards: ScryfallCard[]) => {
      for (const c of cards) map.set(c.id, c);
    }),
  } as unknown as ScryfallCache;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveCards', () => {
  it('returns empty result when no rows have identifiers', async () => {
    const cache = fakeCache();
    const out = await resolveCards([{ name: '' } as ImportRow], cache);
    expect(out.resolved).toEqual([undefined]);
    expect(out.unresolvedNames).toEqual([]);
  });

  it('resolves entirely from the cache when ids hit', async () => {
    const cached = card({ id: 'sf-1' });
    const cache = fakeCache([cached]);
    const fetchSpy = vi.spyOn(global, 'fetch');
    const rows: ImportRow[] = [
      { scryfallId: 'sf-1', name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' },
    ];
    const out = await resolveCards(rows, cache);
    expect(out.resolved[0]).toBe(cached);
    expect(out.unresolvedNames).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to network for cache misses and dedupes identical rows', async () => {
    const cache = fakeCache();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        object: 'list',
        not_found: [],
        data: [card({ id: 'sf-1', name: 'Sol Ring' })],
      })
    );
    const rows: ImportRow[] = [
      { scryfallId: 'sf-1', name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' },
      { scryfallId: 'sf-1', name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' },
    ];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.resolved[0]?.id).toBe('sf-1');
    expect(out.resolved[1]?.id).toBe('sf-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('matches by name + set + collector when no scryfallId is provided', async () => {
    const cache = fakeCache();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        object: 'list',
        not_found: [],
        data: [card({ id: 'sf-x', name: 'Lightning Bolt', set: 'lea', collector_number: '161' })],
      })
    );
    const rows: ImportRow[] = [
      {
        name: 'Lightning Bolt',
        setCode: 'LEA',
        collectorNumber: '161',
        quantity: 1,
        sourceFormat: 'plain',
      },
    ];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.resolved[0]?.id).toBe('sf-x');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.identifiers[0]).toEqual({
      name: 'Lightning Bolt',
      set: 'lea',
      collector_number: '161',
    });
  });

  it('reports rows with no Scryfall match in unresolvedNames', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ object: 'list', not_found: [], data: [] })
    );
    const rows: ImportRow[] = [{ name: 'Notacard', quantity: 1, sourceFormat: 'plain' }];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.unresolvedNames).toEqual(['Notacard']);
  });

  it('normalizes split / DFC names to the front face', async () => {
    const cache = fakeCache();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        object: 'list',
        not_found: [],
        data: [card({ id: 'sf-d', name: 'Front // Back' })],
      })
    );
    const rows: ImportRow[] = [{ name: 'Front // Back', quantity: 1, sourceFormat: 'plain' }];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.resolved[0]?.id).toBe('sf-d');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.identifiers[0]).toEqual({ name: 'Front' });
  });
});

describe('fetchCardsByIds', () => {
  it('returns an empty array for an empty id list', async () => {
    const cache = fakeCache();
    const fetchSpy = vi.spyOn(global, 'fetch');
    expect(await fetchCardsByIds([], cache)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches by id and updates the cache', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ object: 'list', not_found: [], data: [card({ id: 'a' })] })
    );
    const promise = fetchCardsByIds(['a'], cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toHaveLength(1);
    expect(cache.setMany).toHaveBeenCalled();
  });

  it('retries and gives up after a 429 storm', async () => {
    const cache = fakeCache();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 429 }));
    const promise = fetchCardsByIds(['a'], cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toEqual([]);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns [] on non-429 HTTP errors', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const promise = fetchCardsByIds(['a'], cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toEqual([]);
  });

  it('retries network errors before giving up', async () => {
    const cache = fakeCache();
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('boom'));
    const promise = fetchCardsByIds(['a'], cache);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('honors the Retry-After header when present', async () => {
    const cache = fakeCache();
    const responses = [
      new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
      jsonResponse({ object: 'list', not_found: [], data: [card({ id: 'a' })] }),
    ];
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(responses.shift() ?? new Response('done'))
    );
    const promise = fetchCardsByIds(['a'], cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toHaveLength(1);
  });
});

describe('fetchPrintings', () => {
  it('returns an empty array on a 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const promise = fetchPrintings('Nonexistent');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual([]);
  });

  it('paginates while has_more is true', async () => {
    const responses = [
      jsonResponse({
        object: 'list',
        data: [card({ id: 'a' })],
        has_more: true,
        next_page: 'https://api.scryfall.com/cards/search?page=2',
      }),
      jsonResponse({
        object: 'list',
        data: [card({ id: 'b' })],
        has_more: false,
      }),
    ];
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(responses.shift() ?? new Response('done'))
    );
    const promise = fetchPrintings('Sol Ring');
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('strips the back face from split / DFC names in the query', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(jsonResponse({ object: 'list', data: [], has_more: false }));
    const promise = fetchPrintings('Front // Back');
    await vi.runAllTimersAsync();
    await promise;
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain('%21%22Front%22');
    expect(url).not.toContain('Back');
  });

  it('returns an empty array on a 500', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const promise = fetchPrintings('Sol Ring');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual([]);
  });
});

describe('identifyCardByName', () => {
  it('returns the direct fuzzy match when Scryfall finds the card', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(card({ id: 'sf-direct' })));
    const promise = identifyCardByName('Sol Ring');
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out?.id).toBe('sf-direct');
  });

  it('falls back to name-search when fuzzy 404s', async () => {
    // First call (fuzzy) returns 404 — fuzzy thinks the query is
    // ambiguous. Second call (search) returns the canonical match.
    const responses = [
      new Response('not found', { status: 404 }),
      jsonResponse({
        object: 'list',
        data: [card({ id: 'sf-via-search', name: 'Lightning Bolt' })],
        has_more: false,
      }),
    ];
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(responses.shift() ?? new Response('done'))
    );
    const promise = identifyCardByName('Lightning');
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out?.id).toBe('sf-via-search');
  });

  it('falls back to first-word fuzzy when both direct and search fail', async () => {
    // Mimics OCR picking up the subtitle line: "Sol Ring Artifact".
    // Direct fuzzy 404s (no match), name-search 404s, then the
    // two-word fallback "Sol Ring" hits.
    const responses = [
      new Response('not found', { status: 404 }), // direct fuzzy: "Sol Ring Artifact"
      jsonResponse({ object: 'list', data: [], has_more: false }), // search: no hits
      jsonResponse(card({ id: 'sf-by-prefix', name: 'Sol Ring' })), // 2-word fuzzy: "Sol Ring" ✓
    ];
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(responses.shift() ?? new Response('done'))
    );
    const promise = identifyCardByName('Sol Ring Artifact');
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out?.id).toBe('sf-by-prefix');
  });

  it('returns null when every strategy fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    const promise = identifyCardByName('zzzgibberish');
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out).toBeNull();
  });

  it('short-circuits on empty input', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    expect(await identifyCardByName('')).toBeNull();
    expect(await identifyCardByName('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getCardBySetAndNumber', () => {
  it('returns the exact printing on a 200', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        jsonResponse(card({ id: 'sf-exact', set: 'mid', collector_number: '266' }))
      );
    const out = await getCardBySetAndNumber('MID', '266');
    expect(out?.id).toBe('sf-exact');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.scryfall.com/cards/mid/266',
      expect.any(Object)
    );
  });

  it('returns null on a 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    expect(await getCardBySetAndNumber('xyz', '999')).toBeNull();
  });

  it('strips leading zeros from the collector number', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(card()));
    await getCardBySetAndNumber('mid', '00052');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.scryfall.com/cards/mid/52',
      expect.any(Object)
    );
  });

  it('short-circuits without a network call on obviously invalid input', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    expect(await getCardBySetAndNumber('', '266')).toBeNull();
    expect(await getCardBySetAndNumber('mid', '')).toBeNull();
    // Set codes containing punctuation can't be real — defence in depth.
    expect(await getCardBySetAndNumber('m!d', '266')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
