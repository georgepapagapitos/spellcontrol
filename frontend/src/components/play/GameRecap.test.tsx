// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GameAction, GamePlayer, GameState } from '../../lib/game-state';
import { applyAction, createGameState, makePlayer } from '../../lib/game-state';
import { GameRecap } from './GameRecap';

function player(seat: number, name: string, startingLife: number): GamePlayer {
  return makePlayer({ id: `p${seat}`, userId: null, seat, name, startingLife });
}

function play(players: GamePlayer[], startingLife: number, actions: GameAction[]): GameState {
  let state = createGameState({
    id: 'g1',
    code: '',
    mode: 'local',
    hostUserId: null,
    format: 'commander',
    startingLife,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players,
    ts: 0,
  });
  for (const action of actions) state = applyAction(state, action);
  return state;
}

describe('GameRecap', () => {
  it('renders a stat with its label and detail', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);
    const game = play([maya, priya], 40, [
      { type: 'start', ts: 0 },
      { type: 'life', seat: 1, delta: -8, actorSeat: 1, ts: 1_000 },
      { type: 'end', winnerSeat: 0, ts: 60_000 },
    ]);

    render(<GameRecap game={game} />);

    expect(screen.getByText('The story of the game')).toBeTruthy();
    expect(screen.getByText('Game length')).toBeTruthy();
    expect(screen.getByText('1 minute')).toBeTruthy();
  });

  it('renders nothing when the log supports no stats at all', () => {
    const maya = player(0, 'Maya', 40);
    const priya = player(1, 'Priya', 40);
    // No `endedAt` at all -> not even the game-length stat is derivable.
    const game: GameState = {
      ...play([maya, priya], 40, [{ type: 'start', ts: 0 }]),
      endedAt: null,
    };

    const { container } = render(<GameRecap game={game} />);
    expect(container.firstChild).toBeNull();
  });
});
