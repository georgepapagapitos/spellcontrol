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
});
