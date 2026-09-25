// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  applyAction,
  createGameState,
  makePlayer,
  type GameAction,
  type GameState,
} from '@/lib/game-state';
import { loadHordeDeck, resolveHordeSettings, type HordeDeckDef } from '@/lib/horde';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';
import { usePlaytestStore } from '@/playtest/store';
import type { OnlineTable } from './use-online-table';
import { useOnlineHorde } from './use-online-horde';

const MY_DECK = 'deck-mine';

function hordeGame(deckRev = 'test-rev', overrides: Partial<GameState> = {}): GameState {
  let g = createGameState({
    id: 'g1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'horde',
    startingLife: 60,
    commanderDamageEnabled: false,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me-id',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 60,
        isHost: true,
        deckId: MY_DECK,
      }),
      makePlayer({
        id: 'p1',
        userId: 'u1',
        seat: 1,
        name: 'Maya',
        startingLife: 60,
        deckId: 'their-deck',
      }),
    ],
  });
  g = applyAction(g, {
    type: 'horde-setup',
    hordeId: 'zombies',
    level: 'standard',
    settings: resolveHordeSettings('standard', 2),
    seed: 42,
    deckRev,
  });
  g = applyAction(g, { type: 'start' });
  return { ...g, ...overrides };
}

function fakeOnlineTable(mySeat: number, dispatch: (a: GameAction) => void): OnlineTable {
  return {
    activeSeat: null,
    opponents: [],
    mySeat,
    me: hordeGame().players[mySeat],
    players: hordeGame().players,
    isHost: mySeat === 0,
    phase: undefined,
    poisonEnabled: false,
    commanderDamageEnabled: false,
    mulliganType: 'commander',
    turnTimerEnabled: false,
    turnStartedAt: null,
    designations: { monarch: null, initiative: null },
    dispatch,
  };
}

function signIn(id: string) {
  useAuth.setState({ user: { id, username: id, role: 'user' }, status: 'authed' });
}

function resetStores() {
  usePlayStore.setState({ online: null });
  usePlaytestStore.setState({ deckId: MY_DECK, state: null });
  useAuth.setState({ user: null, status: 'unknown' });
}

describe('useOnlineHorde', () => {
  let def: HordeDeckDef;

  beforeAll(async () => {
    def = await loadHordeDeck('zombies');
  });

  beforeEach(() => {
    resetStores();
    vi.restoreAllMocks();
  });

  it('is null with no online game', () => {
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));
    expect(result.current).toBeNull();
  });

  it('reports team state: who is waiting, whether I am done, and setup', () => {
    signIn('me-id');
    const g = hordeGame();
    usePlayStore.setState({ online: g });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));
    expect(result.current?.team.inSetup).toBe(true);
    expect(result.current?.team.iAmDone).toBe(false);
    expect(result.current?.team.waitingOn).toEqual(['Me', 'Maya']);
  });

  it('actions.damage dispatches a horde-step at the current log length', () => {
    signIn('me-id');
    const g = hordeGame();
    usePlayStore.setState({ online: g });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));
    act(() => result.current?.actions.damage(6, null));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'horde-step',
      step: { k: 'damage', n: 6 },
      at: 0,
      actorSeat: 0,
    });
  });

  it('markDone and startWithout dispatch horde-done', () => {
    signIn('me-id');
    usePlayStore.setState({ online: hordeGame() });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));

    act(() => result.current?.markDone(true));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'horde-done', actorSeat: 0, done: true });

    act(() => result.current?.startWithout());
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'horde-done',
      actorSeat: 0,
      done: true,
      force: true,
    });
  });

  it('undoLast dispatches horde-undo at the live log length', () => {
    signIn('me-id');
    const g = hordeGame();
    usePlayStore.setState({ online: g });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));
    act(() => result.current?.undoLast());
    expect(dispatch).toHaveBeenCalledWith({ type: 'horde-undo', at: 0, actorSeat: 0 });
  });

  // Edge-triggered: the log growing after mount toasts; the table this hook
  // was seeded with at mount must not.
  it('toasts on a NEW take step, but not on the steps already in the log at mount', async () => {
    signIn('me-id');
    const dispatch = vi.fn();
    // A take is only legal once the horde's turn has reached combat — reveal
    // then confirm first, and seed the table with those two steps already
    // on the log (mount must not toast for history).
    let g = hordeGame();
    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'reveal' },
      at: g.horde!.steps.length,
      actorSeat: 0,
    });
    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: g.horde!.steps.length,
      actorSeat: 0,
    });
    usePlayStore.setState({ online: g });
    const showSpy = vi.spyOn(toast, 'show');

    renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));
    await waitFor(() => expect(showSpy).not.toHaveBeenCalled());

    // Someone else's take lands on the log.
    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'take', dealt: 8 },
      at: g.horde!.steps.length,
      actorSeat: 1,
    });
    act(() => usePlayStore.setState({ online: g }));

    await waitFor(() =>
      expect(showSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 8 for the team.' })
      )
    );
  });

  it('dispatches end{coopOutcome:"won"} once, when the replay reads the horde as beaten', async () => {
    signIn('me-id');
    // An empty library with no horde creatures on the board reads as won
    // (mirrors lib/horde/replay.test.ts's own "reads won" case) — and the
    // deckRev has to be the real loaded def's, or the replay reads skew
    // instead of computing an outcome at all.
    const base = hordeGame(def.rev);
    const g: GameState = {
      ...base,
      horde: { ...base.horde!, settings: { ...base.horde!.settings, librarySize: 0 } },
    };
    usePlayStore.setState({ online: g });
    const dispatch = vi.fn();
    renderHook(() => useOnlineHorde(fakeOnlineTable(0, dispatch), null));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: 'end',
        winnerSeat: null,
        coopOutcome: 'won',
      })
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
