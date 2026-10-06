import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  dailyArtUrl,
  fetchDailyFriends,
  fetchMyDailyResults,
  playDaily,
  postDailyResults,
} from './daily-client';

afterEach(() => vi.unstubAllGlobals());

function stub(response: Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('playDaily', () => {
  it('posts the body with credentials and returns the state', async () => {
    const fn = stub(new Response(JSON.stringify({ status: 'playing', guesses: [] })));
    await expect(
      playDaily({ guesses: ['Lightning Bolt'], guess: 'Path to Exile' })
    ).resolves.toMatchObject({
      status: 'playing',
    });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toMatch(/\/api\/daily\/play$/);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(init?.body))).toEqual({
      guesses: ['Lightning Bolt'],
      guess: 'Path to Exile',
    });
  });

  it("surfaces the server's sentence, or its own when the body isn't JSON", async () => {
    stub(
      new Response(JSON.stringify({ error: 'No card by that name. Pick one from the list.' }), {
        status: 400,
      })
    );
    await expect(playDaily({ guess: 'Nope' })).rejects.toThrow('No card by that name.');
    stub(new Response('<html>', { status: 502 }));
    await expect(playDaily({})).rejects.toThrow("Couldn't load today's card.");
  });
});

describe('dailyArtUrl', () => {
  it('names the date and blur level', () => {
    expect(dailyArtUrl('2026-10-03', 2)).toMatch(/\/api\/daily\/art\?date=2026-10-03&level=2$/);
  });
});

describe('postDailyResults', () => {
  it('posts the results and returns the saved count', async () => {
    const fn = stub(new Response(JSON.stringify({ saved: 1 })));
    await expect(
      postDailyResults([{ date: '2026-10-01', solved: true, guesses: 3 }])
    ).resolves.toBe(1);
    expect(JSON.parse(String(fn.mock.calls[0]![1]?.body))).toEqual({
      results: [{ date: '2026-10-01', solved: true, guesses: 3 }],
    });
  });

  it('throws on failure', async () => {
    stub(new Response('x', { status: 500 }));
    await expect(postDailyResults([])).rejects.toThrow("Couldn't save your result.");
  });
});

describe('fetchMyDailyResults / fetchDailyFriends', () => {
  it('unwraps the lists', async () => {
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
