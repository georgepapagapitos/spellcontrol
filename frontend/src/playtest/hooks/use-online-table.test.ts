// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaytestState, type PlaytestCard, type PlaytestState } from '@/lib/playtest';
import { toPublicBoard } from '@/lib/playtest/projection';
import type { GameLogEntry } from '@/lib/playtest/game-log';
import { usePlayStore } from '@/store/play';
import { usePlaytestStore } from '../store';
import { useAuth } from '@/store/auth';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';

vi.mock('@/lib/games-board', () => ({ publishBoard: vi.fn(), cancelBoardPublish: vi.fn() }));
import { publishBoard } from '@/lib/games-board';
import { useOnlineTable } from './use-online-table';

const mockPublish = vi.mocked(publishBoard);

function card(id: string, overrides: Partial<PlaytestCard> = {}): PlaytestCard {
  return { id, name: `Secret Card ${id}`, ...overrides };
}

function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`lib${i}`));
}

function state(overrides: Partial<PlaytestState> = {}): PlaytestState {
  const s = createPlaytestState({ library: deck(20), seed: 1, openingHandSize: 7 });
  return { ...s, ...overrides };
}

/** A 3-seat online game: seat 0 is always "me" (userId 'me-id'), matching the
 *  `useAuth` user set in tests that want the viewer seated. */
function onlineGame(overrides: Partial<GameState> = {}): GameState {
  const g = createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me-id',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
      makePlayer({ id: 'p2', userId: 'u2', seat: 2, name: 'Third', startingLife: 33 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), ...overrides };
}

function signIn(id: string) {
  useAuth.setState({ user: { id, username: id, role: 'user' }, status: 'authed' });
}

function resetStores() {
  // Real store action: clears the module-level per-seat ticker cursors too,
  // which plain setState can't reach — without it a previous test's cursor
  // suppresses this test's own-line ingestion.
  usePlayStore.getState().clearOnline();
  usePlayStore.setState({ online: null, onlineBoards: {}, onlineTicker: [] });
  usePlaytestStore.setState({ gameLog: [] });
  useAuth.setState({ user: null, status: 'unknown' });
}

describe('useOnlineTable', () => {
  beforeEach(() => {
    resetStores();
    mockPublish.mockReset();
  });

  it('returns null and never publishes with no online game (solo playtest)', () => {
    const { result } = renderHook(() => useOnlineTable(state()));
    expect(result.current).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // Regression: the table was WRITE-ONLY on the playtest route. `publishBoard`
  // posts directly, so this device's board reached everyone — but the only
  // callers of `startPolling` were PlayPage's mount effect and
  // hostOnline/joinOnline, and PlayPage is NOT mounted at
  // /decks/:id/playtest. A page load straight into playtest therefore
  // subscribed to nothing, no opponent board ever arrived, and the rail sat on
  // "No board shared yet" forever. Found by rendering the real app; no mocked
  // test caught it, which is exactly why these two exist.
  it('starts the realtime transport when seated, so opponent boards can arrive', () => {
    const startPolling = vi.fn();
    usePlayStore.setState({ online: onlineGame(), onlineBoards: {}, startPolling });
    signIn('me-id');
    renderHook(() => useOnlineTable(state()));
    expect(startPolling).toHaveBeenCalled();
  });

  it('does not start the realtime transport in solo playtest', () => {
    const startPolling = vi.fn();
    usePlayStore.setState({ startPolling });
    renderHook(() => useOnlineTable(state()));
    expect(startPolling).not.toHaveBeenCalled();
  });

  it('returns null and never publishes when the viewer holds no seat in the active online game', () => {
    usePlayStore.setState({ online: onlineGame(), onlineBoards: {} });
    signIn('stranger');
    const { result } = renderHook(() => useOnlineTable(state()));
    expect(result.current).toBeNull();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns opponents excluding the viewer own seat when seated', () => {
    usePlayStore.setState({ online: onlineGame({ activeSeat: 1 }), onlineBoards: {} });
    signIn('me-id');
    const { result } = renderHook(() => useOnlineTable(state()));
    expect(result.current).not.toBeNull();
    expect(result.current!.activeSeat).toBe(1);
    const seats = result.current!.opponents.map((o) => o.board.seat).sort();
    expect(seats).toEqual([1, 2]);
    expect(result.current!.opponents.some((o) => o.board.seat === 0)).toBe(false);
  });

  it('marks an opponent who has not published a board yet as pending, using their real life total', () => {
    const publishedBoard = toPublicBoard(state(), 1);
    usePlayStore.setState({
      online: onlineGame(),
      // Only seat 1 has published; seat 2 (life 33, from makePlayer above) hasn't.
      onlineBoards: { 1: publishedBoard },
    });
    signIn('me-id');
    const { result } = renderHook(() => useOnlineTable(state()));

    const rival = result.current!.opponents.find((o) => o.board.seat === 1)!;
    expect(rival.pending).toBeFalsy();
    expect(rival.board).toBe(publishedBoard);

    const third = result.current!.opponents.find((o) => o.board.seat === 2)!;
    expect(third.pending).toBe(true);
    expect(third.board.life).toBe(33);
    expect(third.board.battlefield).toEqual([]);
    expect(third.board.handCount).toBe(0);
    expect(third.board.libraryCount).toBe(0);
  });

  it('publishes a projected board whenever the local playtest state changes', () => {
    usePlayStore.setState({ online: onlineGame(), onlineBoards: {} });
    signIn('me-id');
    const s1 = state();
    renderHook(({ st }) => useOnlineTable(st), { initialProps: { st: s1 } });

    expect(mockPublish).toHaveBeenCalledExactlyOnceWith('ABCD', {
      ...toPublicBoard(s1, 0),
      ticker: [],
    });
  });

  it('re-publishes on a subsequent local board change, and never leaks hand/library contents', () => {
    usePlayStore.setState({ online: onlineGame(), onlineBoards: {} });
    signIn('me-id');
    const s1 = state({
      zones: {
        library: deck(15),
        hand: [card('secrethand', { name: 'Secret Hand Card' })],
        graveyard: [],
        exile: [],
        command: [],
      },
    });
    const { rerender } = renderHook(({ st }) => useOnlineTable(st), { initialProps: { st: s1 } });
    expect(mockPublish).toHaveBeenCalledTimes(1);

    const s2: PlaytestState = { ...s1, turn: s1.turn + 1 };
    rerender({ st: s2 });

    expect(mockPublish).toHaveBeenCalledTimes(2);
    expect(mockPublish).toHaveBeenLastCalledWith('ABCD', {
      ...toPublicBoard(s2, 0),
      ticker: [],
    });
    // The publish payload is the redacted projection, never the raw state —
    // a hand card's name/id must not be reachable from what got sent.
    const lastPayload = mockPublish.mock.calls[mockPublish.mock.calls.length - 1][1];
    const serialized = JSON.stringify(lastPayload);
    expect(serialized).not.toContain('Secret Hand Card');
    expect(serialized).not.toContain('secrethand');
    expect(lastPayload.handCount).toBe(1);
  });

  it('publishes only PUBLIC log lines as the board ticker, and feeds them to the local table feed', () => {
    usePlayStore.setState({ online: onlineGame(), onlineBoards: {} });
    signIn('me-id');
    const gameLog: GameLogEntry[] = [
      { seq: 1, turn: 1, kind: 'play', text: 'Sol Ring played from hand', cardName: 'Sol Ring' },
      { seq: 2, turn: 1, kind: 'life', text: 'Your life: 40 → 37' },
      {
        seq: 3,
        turn: 1,
        kind: 'zone-move',
        text: 'Tutor Target: library → hand',
        cardName: 'Tutor Target',
        from: 'library',
        to: 'hand',
      },
    ];
    usePlaytestStore.setState({ gameLog });
    renderHook(() => useOnlineTable(state()));

    const payload = mockPublish.mock.calls[0][1];
    expect(payload.ticker).toEqual([
      { seq: 1, kind: 'play', text: 'Sol Ring played from hand', cardName: 'Sol Ring' },
    ]);
    // The private lines must not be reachable from what got sent.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('Tutor Target');
    expect(serialized).not.toContain('Your life');

    // Own lines join the local feed under the own seat — what opponents see
    // of me is exactly what the table feed shows me too.
    expect(usePlayStore.getState().onlineTicker.map((it) => `${it.seat}:${it.entry.seq}`)).toEqual([
      '0:1',
    ]);
  });

  it('does not publish at all when solo (no projection performed)', () => {
    const s1 = state();
    const { rerender } = renderHook(({ st }) => useOnlineTable(st), { initialProps: { st: s1 } });
    const s2: PlaytestState = { ...s1, turn: s1.turn + 1 };
    rerender({ st: s2 });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
