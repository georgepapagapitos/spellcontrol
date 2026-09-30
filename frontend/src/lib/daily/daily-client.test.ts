import { afterEach, describe, it, expect, vi } from 'vitest';
import { fetchDailyFriends, fetchMyDailyResults, postDailyResults } from './daily-client';

afterEach(() => vi.unstubAllGlobals());

function stub(response: Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('postDailyResults', () => {
  it('posts the results with credentials and returns the saved count', async () => {
    const fn = stub(new Response(JSON.stringify({ saved: 1 })));
    await expect(
      postDailyResults([{ date: '2026-10-01', solved: true, guesses: 3 }])
    ).resolves.toBe(1);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toMatch(/\/api\/daily\/results$/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(init?.body))).toEqual({
      results: [{ date: '2026-10-01', solved: true, guesses: 3 }],
    });
  });

  it("surfaces the server's error sentence", async () => {
    stub(new Response(JSON.stringify({ error: 'A result date is too early.' }), { status: 400 }));
    await expect(postDailyResults([])).rejects.toThrow('A result date is too early.');
  });

  it('falls back to its own sentence when the body is not JSON', async () => {
    stub(new Response('<html>', { status: 502 }));
    await expect(postDailyResults([])).rejects.toThrow("Couldn't save your result.");
  });
});

describe('fetchMyDailyResults / fetchDailyFriends', () => {
  it('unwraps the result lists', async () => {
    stub(
      new Response(JSON.stringify({ results: [{ date: '2026-10-01', solved: false, guesses: 6 }] }))
    );
    await expect(fetchMyDailyResults()).resolves.toHaveLength(1);
    const fn = stub(new Response(JSON.stringify({ friends: [] })));
    await expect(fetchDailyFriends('2026-10-01')).resolves.toEqual([]);
    expect(String(fn.mock.calls[0]?.[0])).toContain('date=2026-10-01');
  });

  it('throws the fallback sentence on failure', async () => {
    stub(new Response('x', { status: 500 }));
    await expect(fetchMyDailyResults()).rejects.toThrow("Couldn't load your results.");
    stub(new Response('x', { status: 500 }));
    await expect(fetchDailyFriends('2026-10-01')).rejects.toThrow(
      "Couldn't load your friends' results."
    );
  });
});
