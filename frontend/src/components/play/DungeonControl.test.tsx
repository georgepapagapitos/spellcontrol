// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGameState,
  makePlayer,
  type GameAction,
  type GameState,
} from '@spellcontrol/game-core';
import { DungeonControl } from './DungeonControl';
import { SeatBadges, seatHasBadges } from './SeatBadges';

function active(format: GameState['format'] = 'commander'): GameState {
  const lobby = createGameState({
    id: 'g',
    code: 'ABCD',
    mode: 'local',
    hostUserId: null,
    format,
    startingLife: 40,
    commanderDamageEnabled: false,
    poisonEnabled: false,
    players: [0, 1, 2, 3].map((i) =>
      makePlayer({ id: `p${i}`, userId: null, seat: i, name: `P${i}`, startingLife: 40 })
    ),
  });
  return applyAction(lobby, { type: 'start' });
}

/** The real reducer behind the control: what the table and the server both run. */
function Harness({ initial }: { initial: GameState }) {
  const [game, setGame] = useState(initial);
  const dispatch = (a: GameAction) => setGame((g) => applyAction(g, a));
  return (
    <>
      <DungeonControl player={game.players[0]} disabled={false} dispatch={dispatch} />
      <SeatBadges game={game} player={game.players[0]} maxCmdDmg={0} />
    </>
  );
}

describe('DungeonControl', () => {
  it('offers every dungeon when the seat is in none', () => {
    render(<Harness initial={active()} />);
    for (const name of [
      'Undercity',
      'Lost Mine of Phandelver',
      'Dungeon of the Mad Mage',
      'Tomb of Annihilation',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Complete dungeon' })).toBeNull();
  });

  it('enters, moves room to room, completes, and counts it', () => {
    render(<Harness initial={active()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undercity' }));
    // On the board the seat now carries a read-only badge naming the room.
    expect(screen.getByText('Secret Entrance', { selector: '.pp-counter-badge' })).toBeTruthy();
    expect(
      (screen.getByRole('radio', { name: 'Secret Entrance' }) as HTMLInputElement).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Arena' }));
    expect((screen.getByRole('radio', { name: 'Arena' }) as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole('radio', { name: 'Secret Entrance' }) as HTMLInputElement).checked
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Complete dungeon' }));
    expect(screen.getByText('Completed 1 dungeon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undercity' })).toBeTruthy();
  });

  it('takes back a mis-tapped completion and leaves a dungeon without completing it', () => {
    render(<Harness initial={active()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tomb of Annihilation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete dungeon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take back last' }));
    expect(screen.queryByText(/Completed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tomb of Annihilation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(screen.queryByText(/Completed/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Tomb of Annihilation' })).toBeTruthy();
  });

  it('disables every step when the seat cannot be edited', () => {
    const game = active();
    render(<DungeonControl player={game.players[0]} disabled dispatch={() => {}} />);
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('says who sends the seat into the Undercity', () => {
    const game = active();
    render(
      <DungeonControl player={game.players[0]} disabled={false} dispatch={() => {}} initiative />
    );
    expect(screen.getByText('The initiative sends you into the Undercity.')).toBeTruthy();
  });
});

describe('SeatBadges', () => {
  it('shows nothing for a fresh seat at a free-for-all', () => {
    const game = active();
    expect(seatHasBadges(game, game.players[0], 0)).toBe(false);
  });

  it('shows the team at Two-Headed Giant, and the count of completed dungeons', () => {
    const game = active('2hg');
    const done = { ...game.players[2], dungeonsCompleted: ['tomb' as const] };
    expect(seatHasBadges(game, game.players[0], 0)).toBe(true);
    const { container } = render(<SeatBadges game={game} player={done} maxCmdDmg={0} />);
    expect(container.textContent).toContain('Team2');
    expect(container.textContent).toContain('Dungeons1');
  });
});
