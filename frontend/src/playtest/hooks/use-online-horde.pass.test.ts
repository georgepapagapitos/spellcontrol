// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  applyAction,
  createGameState,
  makePlayer,
  type GameAction,
  type GameState,
} from '@spellcontrol/game-core';
import { resolveHordeSettings } from '@/lib/horde';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';
import { usePlaytestStore } from '@/playtest/store';
import type { OnlineTable } from './use-online-table';
import { useOnlineHorde } from './use-online-horde';

// E1037: at an online table, a horde turn with nothing to attack with passes
// on the confirm instead of stopping on "0 creatures, 0 power". Two fixture
// hordes: 'rites' (sorceries only, so no reveal ever puts a creature down)
// and 'zombies' (the tiny zombie fixture, whose reveals do). The rest of the
// engine runs for real.
vi.mock('@/lib/horde', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/horde')>();
  const { ZOMBIE_HORDE_FIXTURE } = await import('@/lib/horde/deck.fixtures');
  const rites = {
    ...ZOMBIE_HORDE_FIXTURE,
    id: 'rites',
    tokens: [],
    spells: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Rite ${id}`, typeLine: 'Sorcery' })),
    lateGame: [],
  };
  return {
    ...actual,
    loadHordeDeck: vi.fn((id: string) =>
      Promise.resolve(id === 'rites' ? rites : ZOMBIE_HORDE_FIXTURE)
    ),
  };
});

const MY_DECK = 'deck-mine';

/** Two seats on the horde's reveal (log: [reveal]). */
function revealing(hordeId: 'rites' | 'zombies'): GameState {
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
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Maya', startingLife: 60 }),
    ],
  });
  g = applyAction(g, {
    type: 'horde-setup',
    hordeId,
    level: 'standard',
    settings: resolveHordeSettings('standard', 2, {
      librarySize: 12,
      bossTicks: [],
      setupTurns: 0,
      reveal: { kind: 'fixed', count: 3 },
    }),
    seed: 42,
    deckRev: 'fixture',
  });
  g = applyAction(g, { type: 'start' });
  return applyAction(g, { type: 'horde-step', step: { k: 'reveal' }, at: 0, actorSeat: 0 });
}

function fakeOnlineTable(g: GameState, dispatch: (a: GameAction) => void): OnlineTable {
  return {
    activeSeat: null,
    opponents: [],
    mySeat: 0,
    me: g.players[0],
    players: g.players,
    isHost: true,
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

function mount(g: GameState) {
  usePlayStore.setState({ online: g });
  const dispatch = vi.fn();
  const hook = renderHook(() => useOnlineHorde(fakeOnlineTable(g, dispatch), null));
  return { dispatch, ...hook };
}

describe('useOnlineHorde: a reveal with nothing to attack (E1037)', () => {
  beforeEach(() => {
    usePlayStore.setState({ online: null });
    usePlaytestStore.setState({ deckId: MY_DECK, state: null });
    useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' }, status: 'authed' });
    vi.restoreAllMocks();
  });

  it('Confirm sends a passing confirm when the reveal leaves no creature', async () => {
    const { result, dispatch } = mount(revealing('rites'));
    await waitFor(() => expect(result.current?.replay?.confirmPasses).toBe(true));
    act(() => result.current?.actions.confirmReveal(null));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'horde-step',
      step: { k: 'confirm', pass: true },
      at: 1,
      actorSeat: 0,
    });
  });

  it('Confirm stays a plain confirm when something can attack', async () => {
    const { result, dispatch } = mount(revealing('zombies'));
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    expect(result.current?.replay?.confirmPasses).toBe(false);
    act(() => result.current?.actions.confirmReveal(null));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
    });
  });

  it('a teammate passing the turn advances my board without a "took 0" toast', async () => {
    let g = revealing('rites');
    const { result } = mount(g);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    const turn = vi.spyOn(usePlaytestStore.getState(), 'dispatch');

    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'confirm', pass: true },
      at: 1,
      actorSeat: 1,
    });
    act(() => usePlayStore.setState({ online: g }));

    await waitFor(() => expect(turn).toHaveBeenCalledWith({ type: 'NEXT_TURN' }));
    expect(show).not.toHaveBeenCalled();
    expect(result.current?.team.phase).toBe('survivors');
    expect(result.current?.replay?.nothingAttacked).toBe(true);
    expect(result.current?.lastStepLabel).toBe('nothing attacked');
  });

  it('a Skip after a plain confirm still toasts, as before', async () => {
    let g = revealing('rites');
    g = applyAction(g, { type: 'horde-step', step: { k: 'confirm' }, at: 1, actorSeat: 0 });
    const { result } = mount(g);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    g = applyAction(g, { type: 'horde-step', step: { k: 'take', dealt: 0 }, at: 2, actorSeat: 1 });
    act(() => usePlayStore.setState({ online: g }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 0 for the team.' })
      )
    );
    expect(result.current?.lastStepLabel).toBe('0 damage taken');
  });

  it('a pass this device disagrees with is announced like any Skip, Undo included', async () => {
    // The zombie fixture's reveal puts creatures down, so this device's own
    // replay sees attackers; the sender's `pass` alone doesn't silence it.
    let g = revealing('zombies');
    const { result } = mount(g);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'confirm', pass: true },
      at: 1,
      actorSeat: 1,
    });
    act(() => usePlayStore.setState({ online: g }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 0 for the team.', actionLabel: 'Undo' })
      )
    );
    expect(result.current?.replay?.nothingAttacked).toBe(false);
  });

  it('an optimistic pass that loses to a plain confirm: the real take still toasts, the board turns once', async () => {
    const start = revealing('rites');
    const { result } = mount(start);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    const turn = vi.spyOn(usePlaytestStore.getState(), 'dispatch');
    const turns = () => turn.mock.calls.filter(([a]) => a.type === 'NEXT_TURN').length;

    // My pass applied optimistically (log: reveal, confirm{pass}, take 0)…
    const mine = applyAction(start, {
      type: 'horde-step',
      step: { k: 'confirm', pass: true },
      at: 1,
      actorSeat: 0,
    });
    act(() => usePlayStore.setState({ online: mine }));
    await waitFor(() => expect(turns()).toBe(1));
    // …then the server's log, where Maya's plain confirm landed first: combat.
    const theirs = applyAction(start, {
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 1,
    });
    act(() => usePlayStore.setState({ online: theirs }));
    expect(result.current?.team.phase).toBe('combat');
    // Maya's Skip lands at the same length my optimistic take had.
    const skipped = applyAction(theirs, {
      type: 'horde-step',
      step: { k: 'take', dealt: 0 },
      at: 2,
      actorSeat: 1,
    });
    act(() => usePlayStore.setState({ online: skipped }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 0 for the team.' })
      )
    );
    expect(turns()).toBe(1);
  });

  it('a Confirm handler from an older render never sends `pass` onto a different log of the same length', async () => {
    const g = revealing('rites');
    const { result, dispatch } = mount(g);
    await waitFor(() => expect(result.current?.replay?.confirmPasses).toBe(true));
    const stale = result.current!.actions;
    // Another log of the same length takes its place (an undo and a new
    // reveal by Maya, say) before the click lands.
    const other: GameState = {
      ...g,
      horde: { ...g.horde!, steps: [{ k: 'reveal', seat: 1, ts: 99 }] },
    };
    act(() => usePlayStore.setState({ online: other }));
    act(() => stale.confirmReveal(null));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'horde-step',
      step: { k: 'confirm' },
      at: 1,
      actorSeat: 0,
    });
  });

  // A device catching up gets a passed turn and the next reveal in one
  // update: the pass is judged by its own confirm, not by the log's latest
  // state (the new reveal has already cleared "nothing attacked").
  it('catching up past a passed turn and the next reveal: still no "took 0" toast', async () => {
    let g = revealing('rites');
    const { result } = mount(g);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    const turn = vi.spyOn(usePlaytestStore.getState(), 'dispatch');
    g = applyAction(g, {
      type: 'horde-step',
      step: { k: 'confirm', pass: true },
      at: 1,
      actorSeat: 1,
    });
    g = applyAction(g, { type: 'horde-step', step: { k: 'reveal' }, at: 3, actorSeat: 1 });
    act(() => usePlayStore.setState({ online: g }));
    await waitFor(() => expect(turn).toHaveBeenCalledWith({ type: 'NEXT_TURN' }));
    expect(result.current?.replay?.nothingAttacked).toBe(false);
    expect(show).not.toHaveBeenCalled();
  });

  it('a take that arrives with later steps behind it is announced without an Undo it cannot act on', async () => {
    let g = revealing('zombies');
    g = applyAction(g, { type: 'horde-step', step: { k: 'confirm' }, at: 1, actorSeat: 0 });
    const { result } = mount(g);
    await waitFor(() => expect(result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    g = applyAction(g, { type: 'horde-step', step: { k: 'take', dealt: 4 }, at: 2, actorSeat: 1 });
    g = applyAction(g, { type: 'horde-step', step: { k: 'reveal' }, at: 3, actorSeat: 1 });
    act(() => usePlayStore.setState({ online: g }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 4 for the team.' })
      )
    );
    const [args] = show.mock.calls[0];
    expect(args.actionLabel).toBeUndefined();
    expect(args.onAction).toBeUndefined();
  });
});

// The board turns once per horde turn, however the log gets there: an undone
// take already advanced this device's board, so the re-take spends that turn
// instead of advancing again, and it is still announced.
describe('useOnlineHorde: undo and re-take advance the board once', () => {
  beforeEach(() => {
    usePlayStore.setState({ online: null });
    usePlaytestStore.setState({ deckId: MY_DECK, state: null });
    useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' }, status: 'authed' });
    vi.restoreAllMocks();
  });

  async function inCombat() {
    let g = revealing('zombies');
    g = applyAction(g, { type: 'horde-step', step: { k: 'confirm' }, at: 1, actorSeat: 0 });
    const hook = mount(g);
    await waitFor(() => expect(hook.result.current?.status).toBe('ready'));
    const show = vi.spyOn(toast, 'show');
    const turn = vi.spyOn(usePlaytestStore.getState(), 'dispatch');
    const turns = () => turn.mock.calls.filter(([a]) => a.type === 'NEXT_TURN').length;
    const land = (next: GameState) => act(() => usePlayStore.setState({ online: next }));
    return { g, show, turns, land };
  }

  it('take, undo, re-take', async () => {
    const { g, show, turns, land } = await inCombat();
    const took = applyAction(g, {
      type: 'horde-step',
      step: { k: 'take', dealt: 3 },
      at: 2,
      actorSeat: 1,
    });
    land(took);
    await waitFor(() => expect(turns()).toBe(1));
    const undone = applyAction(took, { type: 'horde-undo', at: 3, actorSeat: 1 });
    land(undone);
    land(
      applyAction(undone, {
        type: 'horde-step',
        step: { k: 'take', dealt: 5 },
        at: 2,
        actorSeat: 1,
      })
    );
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 5 for the team.' })
      )
    );
    expect(turns()).toBe(1);
  });

  it('take, undo, a damage step, re-take', async () => {
    const { g, show, turns, land } = await inCombat();
    const took = applyAction(g, {
      type: 'horde-step',
      step: { k: 'take', dealt: 3 },
      at: 2,
      actorSeat: 1,
    });
    land(took);
    await waitFor(() => expect(turns()).toBe(1));
    const undone = applyAction(took, { type: 'horde-undo', at: 3, actorSeat: 1 });
    land(undone);
    const hit = applyAction(undone, {
      type: 'horde-step',
      step: { k: 'damage', n: 2 },
      at: 2,
      actorSeat: 0,
    });
    land(hit);
    land(
      applyAction(hit, { type: 'horde-step', step: { k: 'take', dealt: 5 }, at: 3, actorSeat: 1 })
    );
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Maya took 5 for the team.' })
      )
    );
    expect(turns()).toBe(1);
  });
});
