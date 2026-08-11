import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createGame,
  getGame,
  joinGame,
  leaveGame,
  patchGame,
  pollGame,
  postBoard,
} from './games-api';
import type { GameState } from './game-state';
import type { PublicBoard } from './playtest/projection';

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
    startingSeat: null,
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
  });

  it('patchGame throws with status 409 on a version conflict', async () => {
    // Must throw (not swallow the snapshot) so dispatchOnline's 409 recovery runs.
    const current = mockState({ version: 7 });
    fetchSpy.mockResolvedValueOnce(json({ current }, 409));
    await expect(patchGame('ABCD', 4, [{ type: 'start' }])).rejects.toMatchObject({
      status: 409,
    });
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

  it('pollGame builds the URL with since, and appends catchUp=1 only when requested', async () => {
    fetchSpy.mockResolvedValueOnce(json({ unchanged: true }));
    await pollGame('ABCD', 3);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/games/ABCD/poll?since=3');

    fetchSpy.mockResolvedValueOnce(json({ unchanged: true }));
    await pollGame('ABCD', 3, undefined, true);
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/games/ABCD/poll?since=3&catchUp=1');
  });

  it('pollGame resolves game:null on { unchanged: true }', async () => {
    fetchSpy.mockResolvedValueOnce(json({ unchanged: true }));
    expect(await pollGame('ABCD', 3)).toEqual({ game: null, boards: undefined, board: undefined });
  });

  it('pollGame forwards the game and boards from a full response', async () => {
    const game = mockState({ version: 5 });
    const boards = [{ seat: 1, board: { seat: 1 } }];
    fetchSpy.mockResolvedValueOnce(json({ game, boards }));
    expect(await pollGame('ABCD', 3)).toEqual({ game, boards, board: undefined });
  });

  it('pollGame forwards a single resolved board', async () => {
    const board = { seat: 2, board: { seat: 2 } };
    fetchSpy.mockResolvedValueOnce(json({ board }));
    expect(await pollGame('ABCD', 3)).toEqual({ game: null, boards: undefined, board });
  });

  it('postBoard POSTs the board to /board and resolves on success', async () => {
    fetchSpy.mockResolvedValueOnce(json({ ok: true }));
    const board = { seat: 0, turn: 1 } as unknown as PublicBoard;
    await postBoard('ABCD', board);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/games/ABCD/board');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(board);
  });

  it('postBoard throws on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(json({ error: 'Not a participant.' }, 403));
    await expect(postBoard('ABCD', {} as PublicBoard)).rejects.toThrow(/Not a participant/);
  });
});
