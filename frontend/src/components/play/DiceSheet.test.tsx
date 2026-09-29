// @vitest-environment happy-dom
/**
 * The Dice sheet (board T155): one control for dice (a count stepper, die
 * keys that roll on tap and say what they roll, Other… for any die), an
 * always-present result slot, and the coin and quiet first-player pick.
 *
 * Coin flips and dice rolls are genuinely throwaway: they go to the log as
 * prose and that's the whole job. "Who goes first" is different: it's a fact
 * about the game that the on-the-play win-rate rollup aggregates, so the pick
 * has to land in state, not only in a log line nothing can parse.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GamePlayer, GameState } from '@/lib/play/game-state';
import { createGameState, makePlayer } from '@/lib/play/game-state';

vi.mock('@/lib/util/haptics', () => ({
  haptics: { tap: vi.fn(), lethal: vi.fn(), warning: vi.fn(), success: vi.fn(), bump: vi.fn() },
}));
vi.mock('../../store/play', () => {
  const usePlayStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ preferredLayouts: {} });
  return { usePlayStore };
});

import { DiceSheet } from './DiceSheet';

function player(seat: number, name: string): GamePlayer {
  return makePlayer({ id: `p${seat}`, userId: null, seat, name, startingLife: 40 });
}

function makeGame(players: GamePlayer[], over: Partial<GameState> = {}): GameState {
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
    ...over,
  };
}

function renderDice(dispatch = vi.fn(), over: Partial<GameState> = {}) {
  render(
    <DiceSheet
      game={makeGame([player(0, 'Alice'), player(1, 'Bob')], over)}
      dispatch={dispatch}
      onClose={vi.fn()}
    />
  );
  return dispatch;
}

const slot = () => document.querySelector('.dice-slot') as HTMLElement;
const notes = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls
    .map(([a]) => a as { type: string; message?: string })
    .filter((a) => a.type === 'note')
    .map((a) => a.message);

describe('the result slot', () => {
  it('is there before any roll, saying so, and announces what lands in it', () => {
    renderDice();
    expect(slot().getAttribute('aria-live')).toBe('polite');
    expect(slot().textContent).toContain('—');
    expect(slot().textContent).toContain('No roll yet');
  });
});

describe('the die keys', () => {
  it('say exactly what a tap rolls, and roll at once', () => {
    const dispatch = renderDice();
    const keys = [...document.querySelectorAll('.dice-key:not(.dice-key-other)')];
    expect(keys.map((k) => k.textContent)).toEqual(['1d4', '1d6', '1d8', '1d10', '1d12', '1d20']);
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d20' }));
    expect(slot().textContent).toContain('1d20');
    expect(notes(dispatch)).toHaveLength(1);
  });

  it('lands focus on the first die key when the sheet opens', () => {
    renderDice();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Roll 1d4' }));
  });

  it('follow the count stepper, which stops at 1 and 20', () => {
    renderDice();
    const fewer = screen.getByRole('button', { name: 'Fewer dice' }) as HTMLButtonElement;
    const more = screen.getByRole('button', { name: 'More dice' }) as HTMLButtonElement;
    expect(fewer.disabled).toBe(true);
    expect(screen.getByText('die per roll')).toBeTruthy();
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Roll 3d6' }).textContent).toBe('3d6');
    expect(screen.getByText('dice per roll')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Roll 3d6' }));
    expect(document.querySelectorAll('.dice-slot-face')).toHaveLength(3);
    expect(slot().textContent).toContain('3d6 · total');

    for (let i = 0; i < 25; i++) fireEvent.click(more);
    expect(more.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Roll 20d20' })).toBeTruthy();
  });
});

describe('Other…', () => {
  it('opens a sides field and the one primary Roll', () => {
    const dispatch = renderDice();
    const other = screen.getByRole('button', { name: 'Other…' });
    expect(other.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.board-sheet .btn-primary')).toBeNull();
    fireEvent.click(other);
    expect(other.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.board-sheet .btn-primary')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d100' }));
    expect(slot().textContent).toContain('1d100');
    expect(notes(dispatch)).toHaveLength(1);
  });

  it('refuses a die that cannot exist, and says what can', () => {
    renderDice();
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    const sides = screen.getByLabelText('Sides') as HTMLInputElement;
    fireEvent.change(sides, { target: { value: '1' } });
    expect(sides.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Roll' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A die has 2 to 1000 sides.')).toBeTruthy();

    fireEvent.change(sides, { target: { value: '37' } });
    expect((screen.getByRole('button', { name: 'Roll 1d37' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});

describe('coin and first player', () => {
  it('records the first-player pick as state, not just a log note', () => {
    const dispatch = renderDice();
    fireEvent.click(screen.getByRole('button', { name: /Pick first player/ }));

    const settings = dispatch.mock.calls
      .map(([a]) => a as { type: string; patch?: { startingSeat?: number | null } })
      .filter((a) => a.type === 'settings');
    expect(settings).toHaveLength(1);
    // Whichever seat the RNG picked, it must be a real one and it must match
    // the name that was announced (and shown in the slot).
    const seat = settings[0].patch?.startingSeat;
    expect([0, 1]).toContain(seat);
    const name = seat === 0 ? 'Alice' : 'Bob';
    expect(notes(dispatch)[0]).toContain(name);
    expect(slot().textContent).toContain(name);
    expect(slot().textContent).toContain('goes first');
  });

  it('lights up the turn marker on the seat it picked', () => {
    const dispatch = renderDice();
    fireEvent.click(screen.getByRole('button', { name: /Pick first player/ }));
    const calls = dispatch.mock.calls.map(
      ([a]) => a as { type: string; toSeat?: number | null; patch?: { startingSeat?: number } }
    );
    const turn = calls.filter((a) => a.type === 'pass-turn');
    expect(turn).toHaveLength(1);
    // The same seat, not an independent draw: "on the play" and "whose turn is
    // it" are one fact on turn one, and two RNG calls would sometimes disagree.
    expect(turn[0].toSeat).toBe(calls.find((a) => a.type === 'settings')!.patch!.startingSeat);
  });

  it('leaves coin and dice ephemeral: they touch no state', () => {
    const dispatch = renderDice();
    fireEvent.click(screen.getByRole('button', { name: /Flip a coin/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d6' }));
    expect(dispatch.mock.calls.every(([a]) => (a as { type: string }).type === 'note')).toBe(true);
    expect(slot().textContent).toContain('1d6');
  });

  it('shows a coin flip in the slot in words', () => {
    renderDice();
    fireEvent.click(screen.getByRole('button', { name: /Flip a coin/ }));
    expect(slot().textContent).toMatch(/(Heads|Tails)Coin flip/);
  });

  it('keeps only the coin on a finished table', () => {
    renderDice(vi.fn(), { status: 'finished', winnerSeat: 0 });
    expect(screen.queryByRole('button', { name: /Pick first player/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Flip a coin/ })).toBeTruthy();
  });
});
