import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  aggregateDeckRecords,
  gameToRematch,
  recordToRematch,
  usePlayStore,
  type RematchTemplate,
} from './play';
import {
  applyAction,
  createGameState,
  makePlayer,
  type GameRecord,
  type GameState,
} from '../lib/game-state';
import type { PublicBoard } from '../lib/playtest/projection';

// The online flow talks to the games HTTP API; mock it so dispatch/refresh
// branches can be exercised without a server.
vi.mock('../lib/games-api', () => ({
  createGame: vi.fn(),
  getGame: vi.fn(),
  joinGame: vi.fn(),
  leaveGame: vi.fn(),
  patchGame: vi.fn(),
  raiseGameRequest: vi.fn(),
  respondGameRequest: vi.fn(),
}));

import {
  createGame,
  getGame,
  joinGame,
  leaveGame,
  patchGame,
  raiseGameRequest,
  respondGameRequest,
  type GameRequest,
} from '../lib/games-api';

const mockCreate = vi.mocked(createGame);
const mockGet = vi.mocked(getGame);
const mockJoin = vi.mocked(joinGame);
const mockLeave = vi.mocked(leaveGame);
const mockPatch = vi.mocked(patchGame);
const mockRaiseRequest = vi.mocked(raiseGameRequest);
const mockRespondRequest = vi.mocked(respondGameRequest);

// The long-poll transport wraps its own HTTP loop (see games-longpoll.test.ts
// for that in isolation); here we mock the whole module so store tests can
// drive its handlers directly, the same way the SSE tests below drive a
// FakeEventSource.
vi.mock('../lib/games-longpoll', () => ({
  usesLongPoll: vi.fn(() => false),
  subscribeGameLongPoll: vi.fn(),
}));

import {
  usesLongPoll,
  subscribeGameLongPoll,
  type GameLongPollHandlers,
} from '../lib/games-longpoll';

const mockUsesLongPoll = vi.mocked(usesLongPoll);
const mockSubscribeLongPoll = vi.mocked(subscribeGameLongPoll);

function resetStore() {
  usePlayStore.setState({
    local: null,
    online: null,
    onlineBoards: {},
    onlineRequests: {},
    history: [],
    onlineError: null,
    onlinePolling: false,
    boardVisible: true,
    hapticsEnabled: true,
    preferredLayouts: {},
    hydrated: true,
  });
}

/** A started (active) online game at the given version. */
function makeOnlineGame(version = 1): GameState {
  const g = createGameState({
    id: 'game_online',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'u1',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({ id: 'p0', userId: 'u1', seat: 0, name: 'Host', startingLife: 40, isHost: true }),
      makePlayer({ id: 'p1', userId: 'u2', seat: 1, name: 'Guest', startingLife: 40 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), version };
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

function mockGameRequest(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'req1',
    code: 'ABCD',
    kind: 'rewind',
    payload: { steps: 2, summary: 'undo two draws' },
    requesterSeat: 0,
    approvals: {},
    status: 'pending',
    createdAt: 0,
    expiresAt: 60_000,
    ...overrides,
  };
}

describe('usePlayStore — local game flow', () => {
  beforeEach(() => resetStore());

  it('starts a local game with the given setup', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [
        { name: 'Alice', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'Bob', deckId: 'd1', deckName: 'Bob deck', commander: 'X', colorIdentity: ['U'] },
      ],
    });
    const local = usePlayStore.getState().local!;
    expect(local).not.toBeNull();
    expect(local.status).toBe('active');
    expect(local.players).toHaveLength(2);
    expect(local.players[1].deckId).toBe('d1');
  });

  it('honors a remembered layout for the table size', () => {
    usePlayStore.getState().setPreferredLayout(2, 'custom-2up');
    usePlayStore.getState().startLocal({
      format: 'standard',
      startingLife: 20,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    expect(usePlayStore.getState().local!.layout).toBe('custom-2up');
  });

  it('dispatches life delta and updates state', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    usePlayStore.getState().dispatchLocal({ type: 'life', seat: 0, delta: -5, actorSeat: 0 });
    expect(usePlayStore.getState().local!.players[0].life).toBe(35);
  });

  it('dispatchLocal is a no-op with no active local game', () => {
    usePlayStore.getState().dispatchLocal({ type: 'life', seat: 0, delta: -5, actorSeat: 0 });
    expect(usePlayStore.getState().local).toBeNull();
  });

  it('appends a record to history when a local game ends', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: 'da', deckName: 'A deck', commander: null, colorIdentity: [] },
        { name: 'B', deckId: 'db', deckName: 'B deck', commander: null, colorIdentity: [] },
      ],
    });
    usePlayStore.getState().endLocal(0);
    const hist = usePlayStore.getState().history;
    expect(hist).toHaveLength(1);
    expect(hist[0].winnerSeat).toBe(0);
    expect(hist[0].players[0].deckId).toBe('da');
  });

  it('endLocal is a no-op with no active local game', () => {
    usePlayStore.getState().endLocal(0);
    expect(usePlayStore.getState().history).toHaveLength(0);
  });

  it('auto-eliminates and finishes via reducer', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    usePlayStore.getState().dispatchLocal({ type: 'life', seat: 1, delta: -40, actorSeat: 0 });
    const local = usePlayStore.getState().local!;
    expect(local.players[1].eliminated).toBe(true);
    expect(local.status).toBe('finished');
    expect(local.winnerSeat).toBe(0);
    // recordIfFinished should have written the history entry.
    expect(usePlayStore.getState().history).toHaveLength(1);
  });

  it('recordIfFinished does not duplicate a record already in history', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    usePlayStore.getState().endLocal(0);
    expect(usePlayStore.getState().history).toHaveLength(1);
    // A second end on an already-finished game must not re-append.
    usePlayStore.getState().endLocal(0);
    expect(usePlayStore.getState().history).toHaveLength(1);
  });

  it('rematchLocal re-seeds a fresh game from a finished roster', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: 'da', deckName: 'A deck', commander: null, colorIdentity: [] },
        { name: 'B', deckId: 'db', deckName: 'B deck', commander: null, colorIdentity: [] },
      ],
    });
    const firstId = usePlayStore.getState().local!.id;
    usePlayStore.getState().endLocal(0);
    const template = gameToRematch(usePlayStore.getState().local!);
    usePlayStore.getState().rematchLocal(template);
    const fresh = usePlayStore.getState().local!;
    expect(fresh.id).not.toBe(firstId);
    expect(fresh.status).toBe('active');
    expect(fresh.players.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('discardLocal clears the active local game', () => {
    const s = usePlayStore.getState();
    s.startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        { name: 'A', deckId: null, deckName: null, commander: null, colorIdentity: [] },
        { name: 'B', deckId: null, deckName: null, commander: null, colorIdentity: [] },
      ],
    });
    expect(usePlayStore.getState().local).not.toBeNull();
    usePlayStore.getState().discardLocal();
    expect(usePlayStore.getState().local).toBeNull();
    expect(usePlayStore.getState().boardVisible).toBe(true);
  });
});

describe('usePlayStore — board / haptics / layout', () => {
  beforeEach(() => resetStore());

  it('hideBoard / showBoard toggle board visibility', () => {
    usePlayStore.getState().hideBoard();
    expect(usePlayStore.getState().boardVisible).toBe(false);
    usePlayStore.getState().showBoard();
    expect(usePlayStore.getState().boardVisible).toBe(true);
  });

  it('setHaptics updates the persisted flag', () => {
    usePlayStore.getState().setHaptics(false);
    expect(usePlayStore.getState().hapticsEnabled).toBe(false);
    usePlayStore.getState().setHaptics(true);
    expect(usePlayStore.getState().hapticsEnabled).toBe(true);
  });

  it('setPreferredLayout stores and clears a layout per seat count', () => {
    usePlayStore.getState().setPreferredLayout(3, 'triangle');
    expect(usePlayStore.getState().preferredLayouts[3]).toBe('triangle');
    usePlayStore.getState().setPreferredLayout(3, null);
    expect(usePlayStore.getState().preferredLayouts[3]).toBeUndefined();
  });
});

describe('usePlayStore — history mutations', () => {
  beforeEach(() => resetStore());

  function rec(id: string): GameRecord {
    return {
      id,
      code: '',
      format: 'commander',
      startingLife: 40,
      mode: 'local',
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      winnerSeat: 0,
      players: [],
    };
  }

  it('setHistory replaces the whole history list', () => {
    usePlayStore.getState().setHistory([rec('a'), rec('b')]);
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('removeHistory drops the matching record', () => {
    usePlayStore.getState().setHistory([rec('a'), rec('b')]);
    usePlayStore.getState().removeHistory('a');
    expect(usePlayStore.getState().history.map((r) => r.id)).toEqual(['b']);
  });
});

describe('usePlayStore — online flow', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Resets module-level pollTimer / pendingActions / serverCode / serverVersion.
    usePlayStore.getState().clearOnline();
  });

  it('hostOnline stores the game and starts polling', async () => {
    const game = makeOnlineGame(1);
    mockCreate.mockResolvedValue(game);
    const returned = await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    expect(returned).toBe(game);
    expect(usePlayStore.getState().online).toBe(game);
    expect(usePlayStore.getState().onlinePolling).toBe(true);
  });

  it('joinOnline upper-cases the code before calling the API', async () => {
    const game = makeOnlineGame(2);
    mockJoin.mockResolvedValue(game);
    await usePlayStore.getState().joinOnline('abcd', { name: 'Guest' });
    expect(mockJoin).toHaveBeenCalledWith('ABCD', { name: 'Guest' });
    expect(usePlayStore.getState().online).toBe(game);
  });

  it('refreshOnline is a no-op when there is no joined game', async () => {
    await usePlayStore.getState().refreshOnline();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('refreshOnline skips a server snapshot that is not newer', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(3));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const before = usePlayStore.getState().online;
    mockGet.mockResolvedValue(makeOnlineGame(3));
    await usePlayStore.getState().refreshOnline();
    expect(usePlayStore.getState().online).toBe(before);
  });

  it('refreshOnline adopts a newer server snapshot', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const fresh = makeOnlineGame(7);
    mockGet.mockResolvedValue(fresh);
    await usePlayStore.getState().refreshOnline();
    expect(usePlayStore.getState().online).toBe(fresh);
  });

  it('refreshOnline clears the game and stops polling on a 404', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockGet.mockRejectedValue(httpError('gone', 404));
    await usePlayStore.getState().refreshOnline();
    expect(usePlayStore.getState().online).toBeNull();
    expect(usePlayStore.getState().onlineError).toBe('Game ended.');
    expect(usePlayStore.getState().onlinePolling).toBe(false);
  });

  it('dispatchOnline is a no-op with no active online game', async () => {
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('dispatchOnline applies optimistically and adopts the server reply', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const confirmed = { ...makeOnlineGame(2) };
    confirmed.players[0].life = 35;
    mockPatch.mockResolvedValue({ game: confirmed });
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -5, actorSeat: 0 });
    expect(mockPatch).toHaveBeenCalledOnce();
    expect(usePlayStore.getState().online).toBe(confirmed);
    expect(usePlayStore.getState().onlineError).toBeNull();
  });

  it('dispatchOnline surfaces an invalid action without calling the API', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 99, delta: -1, actorSeat: 0 });
    expect(mockPatch).not.toHaveBeenCalled();
    expect(usePlayStore.getState().onlineError).toContain('seat 99');
  });

  it('dispatchOnline recovers from a 409 race by refetching', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockPatch.mockRejectedValue(httpError('conflict', 409));
    const fresh = makeOnlineGame(9);
    mockGet.mockResolvedValue(fresh);
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(usePlayStore.getState().online).toBe(fresh);
    expect(usePlayStore.getState().onlineError).toBe('Action lost a race — refreshed.');
  });

  it('dispatchOnline surfaces a 403 and refetches authoritative state', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockPatch.mockRejectedValue(httpError('Not your turn.', 403));
    mockGet.mockResolvedValue(makeOnlineGame(5));
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(usePlayStore.getState().onlineError).toBe('Not your turn.');
  });

  it('dispatchOnline surfaces a generic patch failure', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockPatch.mockRejectedValue(new Error('network down'));
    mockGet.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(usePlayStore.getState().onlineError).toBe('network down');
  });

  // The optimistic apply already happened, and the batch is spliced out of the
  // pending queue before the request — so a rejected patch left the board
  // showing a move the server never accepted, with nothing to undo it. The
  // poller cannot help: it only adopts server state when
  // `fresh.version > serverVersion`, which a *failed* patch never advances.
  it('dispatchOnline reconciles from the server after a generic patch failure', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const before = usePlayStore.getState().online!.players[0].life;

    mockPatch.mockRejectedValue(new Error('server exploded'));
    const authoritative = makeOnlineGame(1);
    mockGet.mockResolvedValue(authoritative);

    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -5, actorSeat: 0 });

    // Refetched, and the rejected -5 is gone rather than left on screen.
    expect(mockGet).toHaveBeenCalled();
    expect(usePlayStore.getState().online).toBe(authoritative);
    expect(usePlayStore.getState().online!.players[0].life).toBe(before);
    expect(usePlayStore.getState().onlineError).toBe('server exploded');
  });

  it('still surfaces the error when the reconciling refetch also fails', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockPatch.mockRejectedValue(new Error('offline'));
    mockGet.mockRejectedValue(new Error('offline'));
    await usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });
    expect(usePlayStore.getState().onlineError).toBe('offline');
  });

  it('leaveOnline tells the server, clears state, and stops polling', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockLeave.mockResolvedValue(undefined as never);
    await usePlayStore.getState().leaveOnline();
    expect(mockLeave).toHaveBeenCalledWith('ABCD');
    expect(usePlayStore.getState().online).toBeNull();
    expect(usePlayStore.getState().onlinePolling).toBe(false);
  });

  it('leaveOnline is a no-op with no active online game', async () => {
    await usePlayStore.getState().leaveOnline();
    expect(mockLeave).not.toHaveBeenCalled();
  });

  it('leaveOnline still clears local state when the API call fails', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    mockLeave.mockRejectedValue(new Error('offline'));
    await usePlayStore.getState().leaveOnline();
    expect(usePlayStore.getState().online).toBeNull();
  });

  it('startPolling does not stack a second timer', async () => {
    vi.useFakeTimers();
    try {
      mockCreate.mockResolvedValue(makeOnlineGame(1));
      await usePlayStore.getState().hostOnline({
        format: 'commander',
        startingLife: 40,
        commanderDamageEnabled: true,
        poisonEnabled: false,
      });
      usePlayStore.getState().startPolling();
      mockGet.mockResolvedValue(makeOnlineGame(1));
      vi.advanceTimersByTime(2500);
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('raiseGameRequest calls the API and stores the result under the requester seat', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const created = mockGameRequest({ requesterSeat: 0 });
    mockRaiseRequest.mockResolvedValue(created);
    const result = await usePlayStore
      .getState()
      .raiseGameRequest('rewind', { steps: 2, summary: 'undo two draws' });
    expect(result).toEqual(created);
    expect(mockRaiseRequest).toHaveBeenCalledWith('ABCD', 'rewind', {
      steps: 2,
      summary: 'undo two draws',
    });
    expect(usePlayStore.getState().onlineRequests[0]).toEqual(created);
  });

  it('raiseGameRequest rejects with no active online game, without calling the API', async () => {
    await expect(
      usePlayStore.getState().raiseGameRequest('rewind', { steps: 1, summary: 'x' })
    ).rejects.toThrow();
    expect(mockRaiseRequest).not.toHaveBeenCalled();
  });

  it('respondGameRequest calls the API and stores the resolved request', async () => {
    mockCreate.mockResolvedValue(makeOnlineGame(1));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    const resolved = mockGameRequest({ requesterSeat: 1, status: 'approved' });
    mockRespondRequest.mockResolvedValue(resolved);
    const result = await usePlayStore.getState().respondGameRequest('req1', true);
    expect(result).toEqual(resolved);
    expect(mockRespondRequest).toHaveBeenCalledWith('ABCD', 'req1', true);
    expect(usePlayStore.getState().onlineRequests[1]).toEqual(resolved);
  });

  it('respondGameRequest rejects with no active online game, without calling the API', async () => {
    await expect(usePlayStore.getState().respondGameRequest('req1', true)).rejects.toThrow();
    expect(mockRespondRequest).not.toHaveBeenCalled();
  });
});

/**
 * Minimal `EventSource` stand-in — Node has no global `EventSource`, so
 * `startSSE` (store/play.ts) no-ops outside a browser unless one is stubbed
 * in. See lib/games-sse.test.ts for the client wrapper's own unit tests;
 * these cover how the store reconciles pushes with the poll fallback.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  private listeners: Record<string, Array<(ev: { data?: string }) => void>> = {};
  constructor(_url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: { data?: string }) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  emit(type: string, ev: { data?: string } = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  close(): void {
    this.closed = true;
  }
}

describe('usePlayStore — SSE primary transport / poll fallback', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    usePlayStore.getState().clearOnline();
    vi.unstubAllGlobals();
  });

  async function hostAndGetStream(version = 1): Promise<FakeEventSource> {
    mockCreate.mockResolvedValue(makeOnlineGame(version));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
    return FakeEventSource.instances[0];
  }

  it('startPolling opens an SSE stream for the joined game', async () => {
    await hostAndGetStream();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('a poll tick is skipped while the SSE stream is healthy', async () => {
    vi.useFakeTimers();
    try {
      const es = await hostAndGetStream();
      es.emit('open');
      mockGet.mockResolvedValue(makeOnlineGame(1));
      vi.advanceTimersByTime(2500);
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the poll resumes on the very next tick once the stream errors', async () => {
    vi.useFakeTimers();
    try {
      const es = await hostAndGetStream();
      es.emit('open');
      es.emit('error');
      mockGet.mockResolvedValue(makeOnlineGame(1));
      vi.advanceTimersByTime(2500);
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pushed state event adopts a newer version through the same guard as a poll', async () => {
    const es = await hostAndGetStream(1);
    const pushed = makeOnlineGame(9);
    es.emit('state', { data: JSON.stringify(pushed) });
    expect(usePlayStore.getState().online).toEqual(pushed);
  });

  it('a pushed state event with a stale version is ignored', async () => {
    const es = await hostAndGetStream(5);
    const before = usePlayStore.getState().online;
    const stale = makeOnlineGame(2);
    es.emit('state', { data: JSON.stringify(stale) });
    expect(usePlayStore.getState().online).toBe(before);
  });

  it('a pushed state event is skipped while a patch is in flight', async () => {
    const es = await hostAndGetStream(1);
    let resolvePatch!: (v: { game: GameState }) => void;
    mockPatch.mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = resolve;
      })
    );
    const dispatchPromise = usePlayStore
      .getState()
      .dispatchOnline({ type: 'life', seat: 0, delta: -1, actorSeat: 0 });

    // A push arrives mid-flight — must not clobber the optimistic state or
    // the in-flight flusher's eventual adoption of the server's own reply.
    const pushed = makeOnlineGame(9);
    es.emit('state', { data: JSON.stringify(pushed) });
    expect(usePlayStore.getState().online).not.toEqual(pushed);

    resolvePatch({ game: makeOnlineGame(2) });
    await dispatchPromise;
    expect(usePlayStore.getState().online?.version).toBe(2);
  });

  it('stopPolling (leaveOnline) closes the SSE connection', async () => {
    const es = await hostAndGetStream();
    mockLeave.mockResolvedValue(undefined as never);
    await usePlayStore.getState().leaveOnline();
    expect(es.closed).toBe(true);
  });

  it('a pushed board event lands in onlineBoards under its seat', async () => {
    const es = await hostAndGetStream();
    const board = { seat: 1, turn: 3 } as unknown as PublicBoard;
    es.emit('board', { data: JSON.stringify({ seat: 1, board }) });
    expect(usePlayStore.getState().onlineBoards[1]).toEqual(board);
  });

  it('leaveOnline clears onlineBoards along with the rest of the online slice', async () => {
    const es = await hostAndGetStream();
    es.emit('board', { data: JSON.stringify({ seat: 1, board: { seat: 1 } }) });
    expect(usePlayStore.getState().onlineBoards[1]).toBeDefined();
    mockLeave.mockResolvedValue(undefined as never);
    await usePlayStore.getState().leaveOnline();
    expect(usePlayStore.getState().onlineBoards).toEqual({});
  });

  it('a pushed request event lands in onlineRequests under its requester seat', async () => {
    const es = await hostAndGetStream();
    const req = mockGameRequest({ requesterSeat: 1 });
    es.emit('request', { data: JSON.stringify(req) });
    expect(usePlayStore.getState().onlineRequests[1]).toEqual(req);
  });

  it('leaveOnline clears onlineRequests along with the rest of the online slice', async () => {
    const es = await hostAndGetStream();
    es.emit('request', { data: JSON.stringify(mockGameRequest({ requesterSeat: 1 })) });
    expect(usePlayStore.getState().onlineRequests[1]).toBeDefined();
    mockLeave.mockResolvedValue(undefined as never);
    await usePlayStore.getState().leaveOnline();
    expect(usePlayStore.getState().onlineRequests).toEqual({});
  });

  // Regression cover for the sweepStale gap (E-fix, client half): a swept
  // session's SSE stream can look "healthy" forever if this client's
  // subscriber never received the server's deletion broadcast (see the
  // `subscribers` map's cross-machine caveat in routes/games.ts) — the old
  // `if (realtimeHealthy) return` skipped every tick with no other way to
  // ever notice. The fix makes the interval poll force an occasional real
  // check regardless of `realtimeHealthy`.
  it('an occasional liveness check runs even while the SSE stream reports healthy, and clears a game the transport never noticed was gone', async () => {
    vi.useFakeTimers();
    try {
      const es = await hostAndGetStream();
      es.emit('open');
      const notFound = new Error('Game not found.') as Error & { status?: number };
      notFound.status = 404;
      mockGet.mockRejectedValue(notFound);

      // Well under one liveness-check interval (30s): still skipped, exactly
      // like the plain "skipped while healthy" test above.
      await vi.advanceTimersByTimeAsync(27_500);
      expect(mockGet).not.toHaveBeenCalled();

      // Crossing the interval: the occasional recheck fires despite
      // realtimeHealthy never having flipped false.
      await vi.advanceTimersByTimeAsync(2_500);
      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(usePlayStore.getState().online).toBeNull();
      expect(usePlayStore.getState().onlineError).toBe('Game ended.');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('usePlayStore — long-poll transport (native)', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mockUsesLongPoll.mockReturnValue(true);
    // Realistic default teardown fn — individual tests override with
    // mockImplementation when they need to capture/drive the handlers.
    mockSubscribeLongPoll.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    usePlayStore.getState().clearOnline();
  });

  async function hostOnline(version = 1) {
    mockCreate.mockResolvedValue(makeOnlineGame(version));
    await usePlayStore.getState().hostOnline({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
    });
  }

  it('startPolling subscribes via long-poll instead of opening SSE when usesLongPoll() is true', async () => {
    await hostOnline();
    expect(mockSubscribeLongPoll).toHaveBeenCalledTimes(1);
    expect(mockSubscribeLongPoll.mock.calls[0][0]).toBe('ABCD');
  });

  it('a poll tick is skipped once the long-poll reports healthy', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    vi.useFakeTimers();
    try {
      await hostOnline();
      handlers?.onHealthy?.();
      mockGet.mockResolvedValue(makeOnlineGame(1));
      vi.advanceTimersByTime(2500);
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the 2.5s poll resumes immediately once the long-poll errors', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    vi.useFakeTimers();
    try {
      await hostOnline();
      handlers?.onHealthy?.();
      handlers?.onError?.();
      mockGet.mockResolvedValue(makeOnlineGame(1));
      vi.advanceTimersByTime(2500);
      expect(mockGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backs off before retrying a failed long-poll instead of hot-looping', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    vi.useFakeTimers();
    try {
      await hostOnline();
      expect(mockSubscribeLongPoll).toHaveBeenCalledTimes(1);
      handlers?.onError?.();
      // Well short of the backoff — must not have reconnected yet.
      vi.advanceTimersByTime(1000);
      expect(mockSubscribeLongPoll).toHaveBeenCalledTimes(1);
      // Past the backoff — exactly one retry.
      vi.advanceTimersByTime(4500);
      expect(mockSubscribeLongPoll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a state pushed via the long-poll adopts a newer version through the same guard as SSE', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    await hostOnline(1);
    const pushed = makeOnlineGame(9);
    handlers?.onState(pushed);
    expect(usePlayStore.getState().online).toEqual(pushed);
  });

  it('a state pushed via the long-poll with a stale version is ignored', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    await hostOnline(5);
    const before = usePlayStore.getState().online;
    handlers?.onState(makeOnlineGame(2));
    expect(usePlayStore.getState().online).toBe(before);
  });

  it('stopPolling (leaveOnline) tears down the long-poll subscription', async () => {
    const teardown = vi.fn();
    mockSubscribeLongPoll.mockReturnValue(teardown);
    await hostOnline();
    mockLeave.mockResolvedValue(undefined as never);
    await usePlayStore.getState().leaveOnline();
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('a board pushed via the long-poll lands in onlineBoards under its seat', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    await hostOnline();
    const board = { seat: 1, turn: 2 } as unknown as PublicBoard;
    handlers?.onBoard?.(1, board);
    expect(usePlayStore.getState().onlineBoards[1]).toEqual(board);
  });

  it('a request pushed via the long-poll lands in onlineRequests under its requester seat', async () => {
    let handlers: GameLongPollHandlers | undefined;
    mockSubscribeLongPoll.mockImplementation((_c, _s, h) => {
      handlers = h;
      return vi.fn();
    });
    await hostOnline();
    const req = mockGameRequest({ requesterSeat: 1 });
    handlers?.onRequest?.(req);
    expect(usePlayStore.getState().onlineRequests[1]).toEqual(req);
  });
});

describe('usePlayStore — rehydration', () => {
  beforeEach(() => resetStore());

  it('marks hydrated and seeds online polling identity from the snapshot', async () => {
    const online = makeOnlineGame(4);
    localStorage.setItem(
      'mtg-play',
      JSON.stringify({
        state: {
          local: null,
          online,
          history: [],
          boardVisible: true,
          hapticsEnabled: false,
          preferredLayouts: {},
        },
        version: 1,
      })
    );
    await usePlayStore.persist.rehydrate();
    expect(usePlayStore.getState().hydrated).toBe(true);
    expect(usePlayStore.getState().hapticsEnabled).toBe(false);
    expect(usePlayStore.getState().online?.code).toBe('ABCD');
    usePlayStore.getState().clearOnline();
  });
});

describe('gameToRematch / recordToRematch', () => {
  it('gameToRematch carries roster and rule toggles from a live game', () => {
    const game = makeOnlineGame(1);
    const t = gameToRematch(game);
    expect(t.format).toBe('commander');
    expect(t.commanderDamageEnabled).toBe(true);
    expect(t.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
  });

  it('recordToRematch infers commander damage from a commander record', () => {
    const rec: GameRecord = {
      id: 'g',
      code: '',
      format: 'commander',
      startingLife: 40,
      mode: 'local',
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      winnerSeat: 0,
      players: [
        {
          seat: 0,
          userId: null,
          name: 'A',
          deckId: 'd1',
          deckName: 'D1',
          commander: 'Cmd',
          finalLife: 1,
          eliminated: false,
        },
      ],
    };
    const t: RematchTemplate = recordToRematch(rec);
    expect(t.commanderDamageEnabled).toBe(true);
    expect(t.poisonEnabled).toBe(false);
    expect(t.players[0].colorIdentity).toEqual([]);
  });

  it('recordToRematch leaves commander damage off for non-commander formats', () => {
    const rec: GameRecord = {
      id: 'g',
      code: '',
      format: 'standard',
      startingLife: 20,
      mode: 'local',
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
      winnerSeat: null,
      players: [],
    };
    expect(recordToRematch(rec).commanderDamageEnabled).toBe(false);
  });
});

describe('aggregateDeckRecords', () => {
  it('counts wins/losses per deck for the given user (online)', () => {
    const records: GameRecord[] = [
      {
        id: 'g1',
        code: 'AAAA',
        format: 'commander',
        startingLife: 40,
        mode: 'online',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        winnerSeat: 0,
        players: [
          {
            seat: 0,
            userId: 'u1',
            name: 'me',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 1,
            eliminated: false,
          },
          {
            seat: 1,
            userId: 'u2',
            name: 'them',
            deckId: 'd9',
            deckName: 'D9',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
        ],
      },
      {
        id: 'g2',
        code: 'BBBB',
        format: 'commander',
        startingLife: 40,
        mode: 'online',
        startedAt: 3,
        endedAt: 4,
        durationMs: 1,
        winnerSeat: 1,
        players: [
          {
            seat: 0,
            userId: 'u1',
            name: 'me',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
          {
            seat: 1,
            userId: 'u2',
            name: 'them',
            deckId: 'd9',
            deckName: 'D9',
            commander: null,
            finalLife: 5,
            eliminated: false,
          },
        ],
      },
    ];
    const rows = aggregateDeckRecords(records, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].deckId).toBe('d1');
    expect(rows[0].played).toBe(2);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].losses).toBe(1);
    expect(rows[0].winRate).toBe(0.5);
  });

  it('attributes local games by deck (not user)', () => {
    const records: GameRecord[] = [
      {
        id: 'g1',
        code: '',
        format: 'commander',
        startingLife: 40,
        mode: 'local',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        winnerSeat: 0,
        players: [
          {
            seat: 0,
            userId: null,
            name: 'A',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 5,
            eliminated: false,
          },
          {
            seat: 1,
            userId: null,
            name: 'B',
            deckId: 'd2',
            deckName: 'D2',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
        ],
      },
    ];
    const rows = aggregateDeckRecords(records, 'someone');
    expect(rows.map((r) => r.deckId).sort()).toEqual(['d1', 'd2']);
  });

  it('counts a draw as played but neither win nor loss', () => {
    const records: GameRecord[] = [
      {
        id: 'g1',
        code: '',
        format: 'commander',
        startingLife: 40,
        mode: 'local',
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
        winnerSeat: null,
        players: [
          {
            seat: 0,
            userId: null,
            name: 'A',
            deckId: 'd1',
            deckName: 'D1',
            commander: null,
            finalLife: 5,
            eliminated: false,
          },
        ],
      },
    ];
    const rows = aggregateDeckRecords(records, null);
    expect(rows[0].played).toBe(1);
    expect(rows[0].wins).toBe(0);
    expect(rows[0].losses).toBe(0);
    expect(rows[0].winRate).toBe(0);
  });
});
