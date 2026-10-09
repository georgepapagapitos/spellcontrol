import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCommandersWithinColors } from './client';

function page(entries: Array<{ name: string; num_decks: number }>) {
  return {
    kind: 'commanders',
    period: 'year',
    colors: null,
    type: null,
    entries: entries.map((e, i) => ({
      rank: i + 1,
      name: e.name,
      scryfallId: null,
      numDecks: e.num_decks,
      potentialDecks: null,
      salt: null,
    })),
    fetchedAt: 0,
    stale: false,
    sourceUrl: 'https://edhrec.com/commanders',
  };
}

/** Pages keyed by the color letters the backend is asked for (`G`, `WU`, `C`). */
function mockFetch(pages: Record<string, ReturnType<typeof page>>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const colors = new URL(url, 'http://x').searchParams.get('colors') ?? '';
    const body = pages[colors] ?? page([]);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('fetchCommandersWithinColors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns mono-color commanders for an exact-match identity', async () => {
    mockFetch({
      G: page([{ name: 'Elvish Commander', num_decks: 100 }]),
      C: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['G']);
    expect(result.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Elvish Commander', 'Karn, Silver Golem'])
    );
  });

  it('includes strict subsets of a multicolor identity', async () => {
    // Distinct color keys from the other tests — fetchAllCommandersForColor
    // caches per color key for the module lifetime, so a shared file colliding
    // on a key would silently serve another test's cached page.
    const calls = mockFetch({
      W: page([{ name: 'White Commander', num_decks: 80 }]),
      U: page([{ name: 'Blue Commander', num_decks: 90 }]),
      WU: page([{ name: 'Azorius Commander', num_decks: 120 }]),
      C: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['W', 'U']);
    expect(result.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'White Commander',
        'Blue Commander',
        'Azorius Commander',
        'Karn, Silver Golem',
      ])
    );
    // Never asks for pages outside the given identity.
    expect(calls.some((u) => /colors=(WB|UB)(&|$)/.test(u))).toBe(false);
  });

  it('always includes colorless commanders regardless of the given colors', async () => {
    mockFetch({
      B: page([]),
      C: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['B']);
    expect(result.map((c) => c.name)).toContain('Karn, Silver Golem');
  });

  it('excludes a commander outside the given colors', async () => {
    mockFetch({
      R: page([{ name: 'Red Commander', num_decks: 90 }]),
      UB: page([{ name: 'Dimir Commander', num_decks: 200 }]),
      C: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['R']);
    expect(result.map((c) => c.name)).not.toContain('Dimir Commander');
  });
});
