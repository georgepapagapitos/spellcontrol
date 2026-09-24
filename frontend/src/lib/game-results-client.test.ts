import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchLeaderboard,
  fetchH2H,
  fetchMyResults,
  patchGameResult,
  setGameResultHidden,
  resultToRecord,
  type PublicGameResult,
} from './game-results-client';

function publicResult(over: Partial<PublicGameResult> = {}): PublicGameResult {
  return {
    sessionId: 'g1',
    code: '',
    mode: 'local',
    recordedByUserId: 'u1',
    hostUserId: null,
    format: 'commander',
    startingLife: 40,
    winnerSeat: 0,
    winnerUserId: 'u1',
    startedAt: 1000,
    endedAt: 2000,
    durationMs: 1000,
    participants: [
      {
        seat: 0,
        userId: 'u1',
        username: 'u1',
        name: 'P1',
        deckId: null,
        deckName: null,
        commander: null,
        colorIdentity: [],
        finalLife: 40,
        eliminated: false,
      },
    ],
    notableEvents: null,
    ...over,
  };
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
});

describe('resultToRecord', () => {
  it('carries coopOutcome and hordeId onto the record when the row has them', () => {
    const rec = resultToRecord(
      publicResult({
        format: 'horde',
        winnerSeat: null,
        winnerUserId: null,
        coopOutcome: 'won',
        hordeId: 'zombies',
      })
    );
    expect(rec.coopOutcome).toBe('won');
    expect(rec.hordeId).toBe('zombies');
  });

  it('omits coopOutcome and hordeId for a non-co-op row', () => {
    const rec = resultToRecord(publicResult());
    expect(rec.coopOutcome).toBeUndefined();
    expect(rec.hordeId).toBeUndefined();
  });
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
    await expect(fetchH2H('f1')).rejects.toThrow(/Couldn't load your head-to-head record/);
  });
});

describe('fetchMyResults', () => {
  it('asks for the hidden list only when told to, and carries the count back', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        jsonResponse({ results: [], nextCursor: null, hiddenCount: 2 })
      );

    const plain = await fetchMyResults({ limit: 50 });
    expect(plain.hiddenCount).toBe(2);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/game-results/mine?limit=50');

    await fetchMyResults({ hidden: true });
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/game-results/mine?hidden=1');
  });
});

describe('patchGameResult', () => {
  it('PATCHes the correction and unwraps the saved row', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ result: { sessionId: 'g1', winnerSeat: 1 } }));
    const out = await patchGameResult('g 1', { winnerSeat: 1, decks: [] });
    expect(out).toEqual({ sessionId: 'g1', winnerSeat: 1 });
    // The id is escaped: a session id is not assumed to be URL-safe.
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/game-results/g%201');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      credentials: 'include',
    });
  });

  it('throws the server message when it refuses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'That seat is not in this game.' }, { status: 400 })
    );
    await expect(patchGameResult('g1', { winnerSeat: 9, decks: [] })).rejects.toThrow(
      'That seat is not in this game.'
    );
  });
});

describe('setGameResultHidden', () => {
  it('PUTs to hide and DELETEs to bring back', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ ok: true }));
    await setGameResultHidden('g1', true);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/game-results/g1/hidden');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'PUT' });
    await setGameResultHidden('g1', false);
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  it('says which way it failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}, { status: 500 }));
    await expect(setGameResultHidden('g1', true)).rejects.toThrow("Couldn't hide that game.");
    await expect(setGameResultHidden('g1', false)).rejects.toThrow(
      "Couldn't bring that game back."
    );
  });
});
