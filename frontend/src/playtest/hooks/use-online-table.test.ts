// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlaytestState, type PlaytestCard, type PlaytestState } from '@/lib/playtest';
import { toPublicBoard } from '@/lib/playtest/projection';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';

vi.mock('@/lib/games-board', () => ({ publishBoard: vi.fn() }));
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
  usePlayStore.setState({ online: null, onlineBoards: {} });
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

    expect(mockPublish).toHaveBeenCalledExactlyOnceWith('ABCD', toPublicBoard(s1, 0));
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
    expect(mockPublish).toHaveBeenLastCalledWith('ABCD', toPublicBoard(s2, 0));
    // The publish payload is the redacted projection, never the raw state —
    // a hand card's name/id must not be reachable from what got sent.
    const lastPayload = mockPublish.mock.calls[mockPublish.mock.calls.length - 1][1];
    const serialized = JSON.stringify(lastPayload);
    expect(serialized).not.toContain('Secret Hand Card');
    expect(serialized).not.toContain('secrethand');
    expect(lastPayload.handCount).toBe(1);
  });

  it('does not publish at all when solo (no projection performed)', () => {
    const s1 = state();
    const { rerender } = renderHook(({ st }) => useOnlineTable(st), { initialProps: { st: s1 } });
    const s2: PlaytestState = { ...s1, turn: s1.turn + 1 };
    rerender({ st: s2 });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
