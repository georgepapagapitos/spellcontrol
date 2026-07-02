import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveCards,
  fetchCardsByIds,
  fetchPrintings,
  getCardById,
  cardAliasKeys,
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

function fakeCache(
  initial: ScryfallCard[] = [],
  initialLookups: Array<{ key: string; scryfallId: string }> = []
): ScryfallCache {
  const map = new Map<string, ScryfallCard>();
  const lookups = new Map<string, string>();
  for (const c of initial) map.set(c.id, c);
  for (const l of initialLookups) lookups.set(l.key, l.scryfallId);
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
    getManyByKeys: vi.fn((keys: string[]) => {
      const out = new Map<string, ScryfallCard>();
      for (const key of keys) {
        const id = lookups.get(key);
        if (id == null) continue;
        const hit = map.get(id);
        if (hit) out.set(key, hit);
      }
      return out;
    }),
    setLookups: vi.fn((entries: Array<{ key: string; scryfallId: string }>) => {
      for (const e of entries) lookups.set(e.key, e.scryfallId);
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

  it('resolves a name/set lookup from the alias cache without hitting the network', async () => {
    const cached = card({ id: 'sf-1', name: 'Sol Ring', set: 'cmr' });
    const cache = fakeCache([cached], [{ key: 'ns:sol ring|cmr', scryfallId: 'sf-1' }]);
    const fetchSpy = vi.spyOn(global, 'fetch');
    const rows: ImportRow[] = [
      { name: 'Sol Ring', setCode: 'CMR', quantity: 1, sourceFormat: 'plain' },
    ];
    const out = await resolveCards(rows, cache);
    expect(out.resolved[0]).toBe(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records a name/set/collector -> id alias after resolving from the network', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
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
    await promise;
    expect(cache.setLookups).toHaveBeenCalledWith([
      { key: 'nsc:lightning bolt|lea|161', scryfallId: 'sf-x' },
    ]);
    // A second resolution of the same row now hits the alias cache — no new fetch.
    const fetchSpy = vi.spyOn(global, 'fetch');
    fetchSpy.mockClear();
    const out2 = await resolveCards(rows, cache);
    expect(out2.resolved[0]?.id).toBe('sf-x');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not record an alias for id-based lookups', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({ object: 'list', not_found: [], data: [card({ id: 'sf-1' })] })
    );
    const rows: ImportRow[] = [
      { scryfallId: 'sf-1', name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' },
    ];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    await promise;
    expect(cache.setLookups).not.toHaveBeenCalled();
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
    expect(out.fetchErrorNames).toEqual([]);
  });

  // E72 regression: outage vs genuine miss. A batch that never gets an answer
  // must land its rows in fetchErrorNames, NOT unresolvedNames — a 5xx/429
  // storm reporting real cards as typos is exactly the bug this guards.
  it('reports rows from a failed batch (5xx) in fetchErrorNames, not unresolvedNames', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    const rows: ImportRow[] = [{ name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' }];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.resolved[0]).toBeUndefined();
    expect(out.fetchErrorNames).toEqual(['Sol Ring']);
    expect(out.unresolvedNames).toEqual([]);
  });

  it('reports rows in fetchErrorNames after a 429 storm exhausts retries', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    const rows: ImportRow[] = [{ name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' }];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.fetchErrorNames).toEqual(['Sol Ring']);
    expect(out.unresolvedNames).toEqual([]);
  });

  it('reports rows in fetchErrorNames when the network errors out', async () => {
    const cache = fakeCache();
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('network down'));
    const rows: ImportRow[] = [{ name: 'Sol Ring', quantity: 1, sourceFormat: 'plain' }];
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.fetchErrorNames).toEqual(['Sol Ring']);
    expect(out.unresolvedNames).toEqual([]);
  });

  it('splits outage rows from genuine misses when only one batch fails', async () => {
    const cache = fakeCache();
    // 80 distinct names → 2 batches (75 + 5). The first batch echoes back a card
    // per identifier; the second gets a 500. Batch membership is detected by
    // content, not call order, so concurrency can't flake the test.
    vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        identifiers: Array<{ name: string }>;
      };
      if (body.identifiers.some((ident) => ident.name === 'Card 79')) {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      const data = body.identifiers
        .filter((ident) => ident.name !== 'Card 0') // one genuine miss in the good batch
        .map((ident, i) => card({ id: `sf-${ident.name}-${i}`, name: ident.name }));
      return Promise.resolve(jsonResponse({ object: 'list', not_found: [], data }));
    });
    const rows: ImportRow[] = Array.from({ length: 80 }, (_, i) => ({
      name: `Card ${i}`,
      quantity: 1,
      sourceFormat: 'plain' as const,
    }));
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(out.unresolvedNames).toEqual(['Card 0']);
    // Batch 2 = the 5 names past the 75-identifier boundary.
    expect(out.fetchErrorNames).toEqual(['Card 75', 'Card 76', 'Card 77', 'Card 78', 'Card 79']);
  });

  it('resolves more identifiers than fit in one batch across concurrent requests', async () => {
    const cache = fakeCache();
    // Echo back a card for every identifier the batch asked for, so each name resolves.
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        identifiers: Array<{ name: string }>;
      };
      const data = body.identifiers.map((ident, i) =>
        card({ id: `sf-${ident.name}-${i}`, name: ident.name })
      );
      return Promise.resolve(jsonResponse({ object: 'list', not_found: [], data }));
    });
    // 160 distinct names → 3 batches of 75/75/10.
    const rows: ImportRow[] = Array.from({ length: 160 }, (_, i) => ({
      name: `Card ${i}`,
      quantity: 1,
      sourceFormat: 'plain' as const,
    }));
    const promise = resolveCards(rows, cache);
    await vi.runAllTimersAsync();
    const out = await promise;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(out.resolved.every((c) => c !== undefined)).toBe(true);
    expect(out.unresolvedNames).toEqual([]);
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

describe('cardAliasKeys', () => {
  it('produces ns + nsc keys matching the runtime lookup shape', () => {
    expect(cardAliasKeys({ name: 'Sol Ring', set: 'CMR', collector_number: '472' })).toEqual([
      'ns:sol ring|cmr',
      'nsc:sol ring|cmr|472',
    ]);
  });

  it('omits nsc when there is no collector number', () => {
    expect(cardAliasKeys({ name: 'Sol Ring', set: 'cmr' })).toEqual(['ns:sol ring|cmr']);
  });

  it('keys split / DFC cards by their front face', () => {
    expect(cardAliasKeys({ name: 'Front // Back', set: 'mid', collector_number: '50' })).toEqual([
      'ns:front|mid',
      'nsc:front|mid|50',
    ]);
  });

  it('returns no keys when name or set is missing', () => {
    expect(cardAliasKeys({ name: '', set: 'cmr' })).toEqual([]);
    expect(cardAliasKeys({ name: 'Sol Ring', set: '' })).toEqual([]);
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
