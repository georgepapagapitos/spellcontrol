import { describe, it, expect, vi, beforeEach } from 'vitest';

// Re-import per test so the module-level cache resets.
async function freshModule() {
  vi.resetModules();
  return import('./scryfall-catalog');
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchTypeSuggestions', () => {
  it('flattens, dedupes and sorts catalog responses', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ data: ['Beta', 'alpha', 'beta'] }), { status: 200 })
      );
    });
    const { fetchTypeSuggestions } = await freshModule();
    const out = await fetchTypeSuggestions();
    expect(out).toContain('alpha');
    expect(out).toContain('Beta');
    // Sorted ascending
    expect(out).toEqual([...out].sort((a, b) => a.localeCompare(b)));
    // Eight catalogs requested
    expect(calls.length).toBe(8);
  });

  it('returns empty array entries on fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const { fetchTypeSuggestions } = await freshModule();
    expect(await fetchTypeSuggestions()).toEqual([]);
  });

  it('drops non-OK catalog responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const { fetchTypeSuggestions } = await freshModule();
    expect(await fetchTypeSuggestions()).toEqual([]);
  });
});

describe('fetchOracleSuggestions', () => {
  it('always includes the bundled common-phrase list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );
    const { fetchOracleSuggestions } = await freshModule();
    const out = await fetchOracleSuggestions();
    expect(out).toContain('draw a card');
    expect(out).toContain('counter target spell');
  });

  it('caches catalog responses across calls', async () => {
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCount += 1;
      return Promise.resolve(new Response(JSON.stringify({ data: ['flying'] }), { status: 200 }));
    });
    const { fetchOracleSuggestions } = await freshModule();
    await fetchOracleSuggestions();
    const after1 = fetchCount;
    await fetchOracleSuggestions();
    expect(fetchCount).toBe(after1);
  });
});
