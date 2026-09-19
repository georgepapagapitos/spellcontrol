import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameRecord, GameState } from '../lib/game-state';
import type { PublicGameResult } from '../lib/game-results-client';

/**
 * The unified results record, client side: a finished LOCAL game is queued
 * and posted to the server once an account is there; the history list is
 * the server's copy for a signed-in user; removal reaches the server only
 * for a local game this account recorded.
 */

vi.mock('../lib/games-api', () => ({
  createGame: vi.fn(),
  getGame: vi.fn(),
  pollGame: vi.fn(),
  joinGame: vi.fn(),
  patchGame: vi.fn(),
  leaveGame: vi.fn(),
  raiseGameRequest: vi.fn(),
  respondGameRequest: vi.fn(),
  cancelGameRequest: vi.fn(),
  sendGameSignal: vi.fn(),
}));
vi.mock('../lib/games-sse', () => ({ subscribeGameEvents: vi.fn(() => () => {}) }));
vi.mock('../lib/games-longpoll', () => ({
  subscribeGameLongPoll: vi.fn(() => () => {}),
  usesLongPoll: vi.fn(() => false),
}));
vi.mock('../lib/game-results-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/game-results-client')>();
  return {
    ...actual,
    postLocalResult: vi.fn(),
    fetchMyResults: vi.fn(),
    deleteGameResult: vi.fn(),
  };
});

import { usePlayStore } from './play';
import { useAuth } from './auth';
import { postLocalResult, fetchMyResults, deleteGameResult } from '../lib/game-results-client';

const mockPost = vi.mocked(postLocalResult);
const mockFetchMine = vi.mocked(fetchMyResults);
const mockDelete = vi.mocked(deleteGameResult);

function resetStores() {
  usePlayStore.setState({
    local: null,
    online: null,
    history: [],
    pendingResults: [],
    boardVisible: true,
    hydrated: true,
  });
  useAuth.setState({ user: null, status: 'guest' });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Sign in and let the store's own sign-in reaction (flush, then a history
 *  read) settle, so a test's next step never races it. */
async function signIn(id = 'me') {
  useAuth.setState({ user: { id, username: id, role: 'user' }, status: 'authed' });
  await flush();
  await flush();
}

function playAGame(): GameState {
  usePlayStore.getState().startLocal({
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      { name: 'A', deckId: 'da', deckName: 'A deck', commander: null, colorIdentity: [] },
      { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
    ],
  });
  usePlayStore.getState().endLocal(0);
  return usePlayStore.getState().local!;
}

function serverCopy(game: GameState, recordedBy = 'me'): PublicGameResult {
  return {
    sessionId: game.id,
    code: '',
    mode: 'local',
    recordedByUserId: recordedBy,
    format: game.format,
    startingLife: game.startingLife,
    winnerSeat: game.winnerSeat,
    winnerUserId: null,
    startedAt: game.startedAt,
    endedAt: game.endedAt ?? 0,
    durationMs: 0,
    participants: game.players.map((p) => ({
      seat: p.seat,
      userId: p.userId,
      username: null,
      name: p.name,
      deckId: p.deckId,
      deckName: p.deckName,
      commander: p.commander,
      colorIdentity: p.colorIdentity,
      finalLife: p.life,
      eliminated: p.eliminated,
    })),
    notableEvents: [],
    summary: null,
  };
}

function record(
  id: string,
  mode: GameRecord['mode'],
  recordedByUserId?: string | null
): GameRecord {
  return {
    id,
    code: '',
    format: 'commander',
    startingLife: 40,
    players: [],
    winnerSeat: null,
    startedAt: null,
    endedAt: 1,
    durationMs: 0,
    mode,
    ...(recordedByUserId !== undefined ? { recordedByUserId } : {}),
  };
}

beforeEach(() => {
  // Implementations too, not just call counts — a resolved value left over
  // from one test must not feed the next test's sign-in read.
  vi.resetAllMocks();
  mockFetchMine.mockResolvedValue({ results: [], nextCursor: null });
  resetStores();
});

describe('a finished local game and the server record', () => {
  it('as a guest: lands in history and the queue, and nothing is posted', async () => {
    const game = playAGame();
    await flush();
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual([game.id]);
    expect(usePlayStore.getState().pendingResults.map((g) => g.id)).toEqual([game.id]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('signed in: posts on finish and swaps in the server copy (who recorded it)', async () => {
    await signIn();
    mockPost.mockImplementation(async (g) => serverCopy(g));
    const game = playAGame();
    await flush();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0].id).toBe(game.id);
    const s = usePlayStore.getState();
    expect(s.pendingResults).toEqual([]);
    expect(s.history).toHaveLength(1);
    expect(s.history[0].recordedByUserId).toBe('me');
    expect(s.history[0].players[0].deckId).toBe('da');
  });

  it('a queued game posts the moment the account signs in', async () => {
    const game = playAGame();
    await flush();
    expect(mockPost).not.toHaveBeenCalled();
    mockPost.mockImplementation(async (g) => serverCopy(g));
    mockFetchMine.mockResolvedValue({ results: [serverCopy(game)], nextCursor: null });
    await signIn();
    await flush();
    await flush();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(usePlayStore.getState().pendingResults).toEqual([]);
    expect(usePlayStore.getState().history[0].recordedByUserId).toBe('me');
  });

  it('keeps the game queued through a network failure, and retries later', async () => {
    await signIn();
    mockPost.mockRejectedValueOnce(new Error('offline'));
    const game = playAGame();
    await flush();
    expect(usePlayStore.getState().pendingResults.map((g) => g.id)).toEqual([game.id]);
    // The device-built record is still on the list meanwhile.
    expect(usePlayStore.getState().history[0].recordedByUserId).toBeUndefined();

    mockPost.mockImplementation(async (g) => serverCopy(g));
    await usePlayStore.getState().flushPendingResults();
    expect(usePlayStore.getState().pendingResults).toEqual([]);
    expect(usePlayStore.getState().history[0].recordedByUserId).toBe('me');
  });

  it('drops a game the server refused outright instead of retrying it forever', async () => {
    await signIn();
    const refused = Object.assign(new Error('You can only credit yourself or your friends.'), {
      status: 400,
    });
    mockPost.mockRejectedValueOnce(refused);
    const game = playAGame();
    await flush();
    expect(usePlayStore.getState().pendingResults).toEqual([]);
    // Still shown on this device — it just never became a server record.
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual([game.id]);
    await usePlayStore.getState().flushPendingResults();
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('a rate limit is not a verdict — the game stays queued', async () => {
    await signIn();
    mockPost.mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));
    const game = playAGame();
    await flush();
    expect(usePlayStore.getState().pendingResults.map((g) => g.id)).toEqual([game.id]);
  });
});

describe('loadHistory', () => {
  it('is a no-op for a guest', async () => {
    usePlayStore.setState({ history: [record('device-only', 'local')] });
    await usePlayStore.getState().loadHistory();
    expect(mockFetchMine).not.toHaveBeenCalled();
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['device-only']);
  });

  it('signed in: the server list replaces the device copy, keeping games still waiting to post', async () => {
    await signIn();
    const waiting = { ...record('waiting', 'local'), endedAt: 50 };
    usePlayStore.setState({
      history: [waiting, record('stale-cache', 'local')],
      pendingResults: [{ id: 'waiting' } as GameState],
    });
    const fromServer: PublicGameResult = {
      ...serverCopy({
        id: 'srv-1',
        format: 'commander',
        startingLife: 40,
        winnerSeat: 0,
        startedAt: 1,
        endedAt: 10,
        players: [],
      } as unknown as GameState),
      mode: 'online',
      recordedByUserId: null,
    };
    mockFetchMine.mockResolvedValue({ results: [fromServer], nextCursor: null });
    await usePlayStore.getState().loadHistory();
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['waiting', 'srv-1']);
    expect(usePlayStore.getState().history[1].mode).toBe('online');
  });
});

describe('removeHistory', () => {
  it('removes a local game this account recorded from the server too', async () => {
    await signIn();
    mockDelete.mockResolvedValue();
    usePlayStore.setState({ history: [record('mine', 'local', 'me')] });
    usePlayStore.getState().removeHistory('mine');
    expect(usePlayStore.getState().history).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith('mine');
  });

  it('never calls the server for an online record or one someone else recorded', async () => {
    await signIn();
    usePlayStore.setState({
      history: [record('online', 'online', null), record('theirs', 'local', 'friend')],
    });
    usePlayStore.getState().removeHistory('online');
    usePlayStore.getState().removeHistory('theirs');
    expect(usePlayStore.getState().history).toEqual([]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('a game still waiting to post is just dropped from the queue', async () => {
    await signIn();
    usePlayStore.setState({
      history: [record('queued', 'local')],
      pendingResults: [{ id: 'queued' } as GameState],
    });
    usePlayStore.getState().removeHistory('queued');
    expect(usePlayStore.getState().pendingResults).toEqual([]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('a guest removes only the device copy', () => {
    usePlayStore.setState({ history: [record('g', 'local')] });
    usePlayStore.getState().removeHistory('g');
    expect(usePlayStore.getState().history).toEqual([]);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
