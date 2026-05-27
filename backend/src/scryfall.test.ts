import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCards, fetchCardsByIds, fetchPrintings, getCardById } from './scryfall';
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

describe('getCardById', () => {
  it('returns the cached card without hitting Scryfall when the id is in cache', async () => {
    const cache = fakeCache([card({ id: 'cached-id' })]);
    const fetchSpy = vi.spyOn(global, 'fetch');
    const out = await getCardById('cached-id', cache);
    expect(out?.id).toBe('cached-id');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to fetchCardsByIds + caches on a cache miss', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ object: 'list', not_found: [], data: [card({ id: 'fresh-id' })] })
    );
    const promise = getCardById('fresh-id', cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out?.id).toBe('fresh-id');
    expect(cache.setMany).toHaveBeenCalled();
  });

  it('returns null when Scryfall does not know the id', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ object: 'list', not_found: [{ id: 'missing' }], data: [] })
    );
    const promise = getCardById('missing', cache);
    await vi.runAllTimersAsync();
    expect(await promise).toBeNull();
  });
});
