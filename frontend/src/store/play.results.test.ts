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
    patchGameResult: vi.fn(),
    setGameResultHidden: vi.fn(),
  };
});

import { gameToRematch, recordToRematch, usePlayStore } from './play';
import { useAuth } from './auth';
import {
  postLocalResult,
  fetchMyResults,
  deleteGameResult,
  patchGameResult,
  setGameResultHidden,
} from '../lib/game-results-client';

const mockPost = vi.mocked(postLocalResult);
const mockFetchMine = vi.mocked(fetchMyResults);
const mockDelete = vi.mocked(deleteGameResult);
const mockPatch = vi.mocked(patchGameResult);
const mockSetHidden = vi.mocked(setGameResultHidden);

function resetStores() {
  usePlayStore.setState({
    local: null,
    online: null,
    history: [],
    hiddenHistory: [],
    hiddenCount: 0,
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
  mockFetchMine.mockResolvedValue({ results: [], nextCursor: null, hiddenCount: 0 });
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
    mockFetchMine.mockResolvedValue({
      results: [serverCopy(game)],
      nextCursor: null,
      hiddenCount: 0,
    });
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

describe('seats are people', () => {
  it('startLocal seats the account behind a seat, and a rematch keeps it', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [
        {
          name: 'Georg',
          userId: 'me',
          username: 'georg',
          deckId: null,
          deckName: null,
          commander: null,
          colorIdentity: [],
        },
        { name: 'Walk-up', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    const local = usePlayStore.getState().local!;
    expect(local.players.map((p) => p.userId)).toEqual(['me', null]);
    expect(gameToRematch(local).players.map((p) => p.userId)).toEqual(['me', null]);
    usePlayStore.getState().endLocal(0);
    const rec = usePlayStore.getState().history[0];
    expect(recordToRematch(rec).players.map((p) => p.userId)).toEqual(['me', null]);
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
    mockFetchMine.mockResolvedValue({ results: [fromServer], nextCursor: null, hiddenCount: 0 });
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

describe('editHistory', () => {
  const seats = (winnerSeat: number | null): GameRecord => ({
    ...record('mine', 'local', 'me'),
    winnerSeat,
    players: [
      {
        seat: 0,
        userId: null,
        name: 'A',
        deckId: null,
        deckName: null,
        commander: null,
        finalLife: 40,
        eliminated: false,
      },
      {
        seat: 1,
        userId: null,
        name: 'B',
        deckId: null,
        deckName: null,
        commander: null,
        finalLife: 0,
        eliminated: true,
      },
    ],
  });

  it('shows the correction at once and writes it through', async () => {
    const playedGame = playAGame();
    resetStores();
    await signIn();
    usePlayStore.setState({ history: [seats(1)] });
    mockPatch.mockImplementation(async () => {
      // The row already reads as corrected before the server answers.
      expect(usePlayStore.getState().history[0].winnerSeat).toBe(0);
      return {
        ...serverCopy({ ...playedGame, id: 'mine' }),
        sessionId: 'mine',
        winnerSeat: 0,
      };
    });
    await usePlayStore.getState().editHistory('mine', { winnerSeat: 0, decks: [] });
    expect(mockPatch).toHaveBeenCalledWith('mine', { winnerSeat: 0, decks: [] });
    expect(usePlayStore.getState().history[0].winnerSeat).toBe(0);
  });

  it('puts the row back when the write fails, rather than leaving it looking saved', async () => {
    await signIn();
    usePlayStore.setState({ history: [seats(1)] });
    mockPatch.mockRejectedValue(new Error('offline'));
    await usePlayStore.getState().editHistory('mine', { winnerSeat: 0, decks: [] });
    expect(usePlayStore.getState().history[0].winnerSeat).toBe(1);
  });

  it('corrects a game still queued in the queue itself, not on the server', async () => {
    await signIn();
    usePlayStore.setState({
      history: [{ ...seats(1), id: 'queued' }],
      pendingResults: [
        { id: 'queued', winnerSeat: 1, players: [{ seat: 0 }, { seat: 1 }] } as GameState,
      ],
    });
    await usePlayStore.getState().editHistory('queued', {
      winnerSeat: 0,
      decks: [{ seat: 0, deckId: 'd', deckName: 'Deck', commander: null, colorIdentity: ['G'] }],
    });
    expect(mockPatch).not.toHaveBeenCalled();
    const queued = usePlayStore.getState().pendingResults[0];
    expect(queued.winnerSeat).toBe(0);
    expect(queued.players[0].deckName).toBe('Deck');
    expect(usePlayStore.getState().history[0].players[0].deckName).toBe('Deck');
  });

  it('a guest corrects the device copy and calls nothing', async () => {
    usePlayStore.setState({ history: [seats(1)] });
    await usePlayStore.getState().editHistory('mine', { winnerSeat: 0, decks: [] });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(usePlayStore.getState().history[0].winnerSeat).toBe(0);
  });
});

describe('setHistoryHidden', () => {
  it('moves the row to the hidden list and back, keeping the count in step', async () => {
    await signIn();
    mockSetHidden.mockResolvedValue();
    usePlayStore.setState({ history: [record('online', 'online', null)], hiddenCount: 0 });

    await usePlayStore.getState().setHistoryHidden('online', true);
    expect(usePlayStore.getState().history).toEqual([]);
    expect(usePlayStore.getState().hiddenHistory.map((r) => r.id)).toEqual(['online']);
    expect(usePlayStore.getState().hiddenCount).toBe(1);
    expect(mockSetHidden).toHaveBeenCalledWith('online', true);

    await usePlayStore.getState().setHistoryHidden('online', false);
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['online']);
    expect(usePlayStore.getState().hiddenHistory).toEqual([]);
    expect(usePlayStore.getState().hiddenCount).toBe(0);
  });

  it('puts the row back when the server refuses', async () => {
    await signIn();
    mockSetHidden.mockRejectedValue(new Error('nope'));
    usePlayStore.setState({ history: [record('online', 'online', null)], hiddenCount: 0 });
    await usePlayStore.getState().setHistoryHidden('online', true);
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['online']);
    expect(usePlayStore.getState().hiddenHistory).toEqual([]);
    expect(usePlayStore.getState().hiddenCount).toBe(0);
  });

  it('a guest list is this device only, so nothing is told to the server', async () => {
    usePlayStore.setState({ history: [record('online', 'online', null)] });
    await usePlayStore.getState().setHistoryHidden('online', true);
    expect(mockSetHidden).not.toHaveBeenCalled();
    expect(usePlayStore.getState().history).toEqual([]);
  });

  it('loadHistory adopts the server hidden count', async () => {
    mockFetchMine.mockResolvedValue({ results: [], nextCursor: null, hiddenCount: 4 });
    await signIn();
    expect(usePlayStore.getState().hiddenCount).toBe(4);
  });
});
