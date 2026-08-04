// @vitest-environment happy-dom
/**
 * The table tools' one non-ephemeral result.
 *
 * Coin flips and dice rolls are genuinely throwaway — they go to the log as
 * prose and that's the whole job. "Who goes first" is different: it's a fact
 * about the game that the on-the-play win-rate rollup aggregates, so the pick
 * has to land in state, not only in a log line nothing can parse.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '../../lib/game-state';
import { createGameState, makePlayer } from '../../lib/game-state';

vi.mock('../../lib/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));

import { GameTools } from './GameTools';

function player(seat: number, name: string): GamePlayer {
  return makePlayer({ id: `p${seat}`, userId: null, seat, name, startingLife: 40 });
}

function makeGame(players: GamePlayer[]): GameState {
  return {
    ...createGameState({
      id: 'g1',
      code: '',
      mode: 'local',
      hostUserId: null,
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players,
    }),
    status: 'active',
  };
}

describe('GameTools — first player', () => {
  it('records the pick as state, not just a log note', () => {
    const dispatch = vi.fn();
    render(
      <GameTools game={makeGame([player(0, 'Alice'), player(1, 'Bob')])} dispatch={dispatch} />
    );

    fireEvent.click(screen.getByRole('button', { name: /First player/ }));

    const settings = dispatch.mock.calls
      .map(([a]) => a as { type: string; patch?: { startingSeat?: number | null } })
      .filter((a) => a.type === 'settings');
    expect(settings).toHaveLength(1);
    // Whichever seat the RNG picked, it must be a real one and it must match
    // the name that was announced.
    const seat = settings[0].patch?.startingSeat;
    expect([0, 1]).toContain(seat);

    const notes = dispatch.mock.calls
      .map(([a]) => a as { type: string; message?: string })
      .filter((a) => a.type === 'note');
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain(seat === 0 ? 'Alice' : 'Bob');
  });

  it('leaves coin and dice ephemeral — they touch no state', () => {
    const dispatch = vi.fn();
    render(
      <GameTools game={makeGame([player(0, 'Alice'), player(1, 'Bob')])} dispatch={dispatch} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Flip coin/ }));

    expect(dispatch.mock.calls.every(([a]) => (a as { type: string }).type === 'note')).toBe(true);
  });
});
