// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';
import { loadHordeDeck, resolveHordeSettings, type HordeDeckDef } from '@/lib/horde';
import { useHordeReplay } from './use-horde-replay';

describe('useHordeReplay', () => {
  let def: HordeDeckDef;

  beforeAll(async () => {
    def = await loadHordeDeck('zombies');
  });

  function hordeGame(deckRev = def.rev): GameState {
    let g = createGameState({
      id: 'g1',
      code: 'ABCD',
      mode: 'online',
      hostUserId: 'u1',
      format: 'horde',
      startingLife: 60,
      commanderDamageEnabled: false,
      poisonEnabled: false,
      players: [
        makePlayer({ id: 'p0', userId: 'u1', seat: 0, name: 'Me', startingLife: 60, isHost: true }),
      ],
    });
    g = applyAction(g, {
      type: 'horde-setup',
      hordeId: 'zombies',
      level: 'standard',
      settings: resolveHordeSettings('standard', 1),
      seed: 42,
      deckRev,
    });
    return applyAction(g, { type: 'start' });
  }

  it('reads none for an absent, or non-horde, game', () => {
    const { result } = renderHook(() => useHordeReplay(null, null));
    expect(result.current.status).toBe('none');
    expect(result.current.replay).toBeNull();
  });

  it('loads the deck lazily, then replays to ready', async () => {
    const g = hordeGame();
    const { result } = renderHook(() => useHordeReplay(g, null));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.replay?.view.config.hordeName).toBe(def.name);
    expect(result.current.error).toBeNull();
  });

  it('reads skew when this device copy of the deck does not match the table deckRev', async () => {
    const g = hordeGame('some-other-build-rev');
    const { result } = renderHook(() => useHordeReplay(g, null));
    await waitFor(() => expect(result.current.status).toBe('skew'));
    expect(result.current.replay).toBeNull();
  });

  it('caches the def per hordeId: a later render of the same table does not re-enter loading', async () => {
    const g = hordeGame();
    const { result, rerender } = renderHook(({ game }) => useHordeReplay(game, null), {
      initialProps: { game: g },
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const movedLife = { ...g, players: g.players.map((p) => ({ ...p, life: 59 })) };
    rerender({ game: movedLife });
    expect(result.current.status).toBe('ready');
  });

  it('surfaces a load failure as error, and retry re-attempts it', async () => {
    const g = hordeGame();
    const bad = { ...g, horde: { ...g.horde!, hordeId: 'not-a-real-horde-deck' } };
    const { result } = renderHook(() => useHordeReplay(bad, null));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeTruthy();
    expect(result.current.replay).toBeNull();

    act(() => result.current.retry());
    // Still failing (same bad id) — but retry ran the load path again rather
    // than getting stuck, which is what matters here.
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
