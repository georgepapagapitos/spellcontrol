import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCommandersWithinColors } from './client';

function page(entries: Array<{ name: string; num_decks: number }>) {
  return {
    container: {
      json_dict: {
        cardlists: [
          {
            tag: 'topcommanders',
            cardviews: entries.map((e) => ({
              name: e.name,
              sanitized: e.name.toLowerCase().replace(/\s+/g, '-'),
              num_decks: e.num_decks,
            })),
          },
        ],
      },
    },
  };
}

function mockFetch(pages: Record<string, ReturnType<typeof page>>) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    calls.push(url);
    const slug = Object.keys(pages).find((s) => url.endsWith(`/${s}.json`));
    const body = slug ? pages[slug] : { container: { json_dict: { cardlists: [] } } };
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
      'mono-green': page([{ name: 'Elvish Commander', num_decks: 100 }]),
      colorless: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
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
      'mono-white': page([{ name: 'White Commander', num_decks: 80 }]),
      'mono-blue': page([{ name: 'Blue Commander', num_decks: 90 }]),
      azorius: page([{ name: 'Azorius Commander', num_decks: 120 }]),
      colorless: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
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
    expect(calls.some((u) => u.includes('orzhov') || u.includes('dimir'))).toBe(false);
  });

  it('always includes colorless commanders regardless of the given colors', async () => {
    mockFetch({
      'mono-black': page([]),
      colorless: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['B']);
    expect(result.map((c) => c.name)).toContain('Karn, Silver Golem');
  });

  it('excludes a commander outside the given colors', async () => {
    mockFetch({
      'mono-red': page([{ name: 'Red Commander', num_decks: 90 }]),
      dimir: page([{ name: 'Dimir Commander', num_decks: 200 }]),
      colorless: page([{ name: 'Karn, Silver Golem', num_decks: 10 }]),
    });
    const result = await fetchCommandersWithinColors(['R']);
    expect(result.map((c) => c.name)).not.toContain('Dimir Commander');
  });
});
