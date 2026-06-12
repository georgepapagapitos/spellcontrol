import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGame, getGame, joinGame, leaveGame, patchGame } from './games-api';
import type { GameState } from './game-state';

function mockState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    status: 'lobby',
    hostUserId: 'u0',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    layout: 'pod',
    tapOrientation: 'horizontal',
    activeSeat: null,
    designations: { monarch: null, initiative: null },
    players: [],
    events: [],
    winnerSeat: null,
    createdAt: 0,
    updatedAt: 0,
    startedAt: null,
    endedAt: null,
    version: 0,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('games-api', () => {
  it('createGame POSTs to /api/games and returns the game', async () => {
    const game = mockState();
    fetchSpy.mockResolvedValueOnce(json({ game }));
    const result = await createGame({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    expect(result).toEqual(game);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    );
  });

  it('getGame URL-encodes the code', async () => {
    const game = mockState({ code: 'AB CD' });
    fetchSpy.mockResolvedValueOnce(json({ game }));
    expect(await getGame('AB CD')).toEqual(game);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/games/AB%20CD');
  });

  it('getGame appends knownVersion and returns the full state when it changed', async () => {
    const game = mockState({ version: 9 });
    fetchSpy.mockResolvedValueOnce(json({ game }));
    expect(await getGame('ABCD', 8)).toEqual(game);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/games/ABCD?knownVersion=8');
  });

  it('getGame resolves to null when the server reports it is unchanged', async () => {
    fetchSpy.mockResolvedValueOnce(json({ unchanged: true }));
    expect(await getGame('ABCD', 5)).toBeNull();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/games/ABCD?knownVersion=5');
  });

  it('joinGame POSTs payload to /join', async () => {
    const game = mockState();
    fetchSpy.mockResolvedValueOnce(json({ game }));
    const result = await joinGame('ABCD', { name: 'Alice', deckId: 'd1' });
    expect(result).toEqual(game);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/games/ABCD/join');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Alice',
      deckId: 'd1',
    });
  });

  it('patchGame returns the server game on 200', async () => {
    const game = mockState({ version: 5 });
    fetchSpy.mockResolvedValueOnce(json({ game }));
    const result = await patchGame('ABCD', 4, [{ type: 'start' }]);
    expect(result.game).toEqual(game);
    expect(result.conflict).toBeUndefined();
  });

  it('patchGame surfaces the server snapshot on 409', async () => {
    const current = mockState({ version: 7 });
    fetchSpy.mockResolvedValueOnce(json({ current }, 409));
    const result = await patchGame('ABCD', 4, [{ type: 'start' }]);
    expect(result.game).toEqual(current);
    expect(result.conflict).toEqual(current);
  });

  it('patchGame throws on non-409 errors', async () => {
    fetchSpy.mockResolvedValueOnce(json({ error: 'nope' }, 403));
    await expect(patchGame('ABCD', 0, [{ type: 'start' }])).rejects.toThrow(/nope/);
  });

  it('leaveGame returns the body verbatim', async () => {
    fetchSpy.mockResolvedValueOnce(json({ deleted: true }));
    expect(await leaveGame('ABCD')).toEqual({ deleted: true });
    fetchSpy.mockResolvedValueOnce(json({ game: mockState() }));
    const r = await leaveGame('EFGH');
    expect(r.game?.code).toBe('ABCD');
  });
});
