import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchLeaderboard, fetchH2H } from './game-results-client';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchLeaderboard', () => {
  it('GETs the leaderboard with credentials and unwraps the array', async () => {
    const entry = {
      friendId: 'f1',
      friendUsername: 'bob',
      gamesPlayed: 3,
      callerWins: 2,
      friendWins: 1,
      lastPlayedAt: 100,
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ leaderboard: [entry] }));
    const out = await fetchLeaderboard();
    expect(out).toEqual([entry]);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/game-results/leaderboard',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws the server error message on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'nope' }, { status: 500 })
    );
    await expect(fetchLeaderboard()).rejects.toThrow('nope');
  });
});

describe('fetchH2H', () => {
  it('GETs the encoded friend path and returns the payload', async () => {
    const payload = {
      friend: { id: 'f1', username: 'bob' },
      results: [],
      summary: { gamesPlayed: 0, callerWins: 0, friendWins: 0, deckMatchups: [] },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));
    const out = await fetchH2H('f1/x');
    expect(out).toEqual(payload);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/game-results/h2h/f1%2Fx',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('throws on 403 (not friends) with the fallback when no error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    await expect(fetchH2H('f1')).rejects.toThrow('Failed to load head-to-head.');
  });
});
