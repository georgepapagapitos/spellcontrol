// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GameResultEditDialog } from './GameResultEditDialog';
import type { GameRecord } from '../../lib/game-state';

/**
 * The dialog shows a seat's deck by name, but a GameRecord does not carry the
 * colors or the commander behind it. Saving every seat would therefore blank
 * fields the server holds and this screen never had — so only seats that were
 * actually re-picked may travel. That is the invariant worth a guard.
 */

const record: GameRecord = {
  id: 'g1',
  code: '',
  format: 'commander',
  startingLife: 40,
  players: [
    {
      seat: 0,
      userId: null,
      name: 'Ana',
      deckId: 'd0',
      deckName: 'Atraxa',
      commander: 'Atraxa',
      finalLife: 40,
      eliminated: false,
    },
    {
      seat: 1,
      userId: null,
      name: 'Ben',
      deckId: null,
      deckName: null,
      commander: null,
      finalLife: 0,
      eliminated: true,
    },
  ],
  winnerSeat: 0,
  startedAt: null,
  endedAt: 1_000,
  durationMs: 0,
  mode: 'local',
};

describe('GameResultEditDialog', () => {
  it('saves the winner alone when no deck was re-picked', () => {
    const onSave = vi.fn();
    render(<GameResultEditDialog record={record} decks={[]} onCancel={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole('radio', { name: 'No winner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ winnerSeat: null, decks: [] });
  });

  it('offers an eliminated seat but will not let it win', () => {
    render(
      <GameResultEditDialog record={record} decks={[]} onCancel={() => {}} onSave={() => {}} />
    );
    expect((screen.getByRole('radio', { name: /Ben/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: 'Ana' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('starts on the winner the record already holds', () => {
    render(
      <GameResultEditDialog record={record} decks={[]} onCancel={() => {}} onSave={() => {}} />
    );
    expect((screen.getByRole('radio', { name: 'Ana' }) as HTMLInputElement).checked).toBe(true);
  });

  it('shows each seat the deck the record holds for it', () => {
    render(
      <GameResultEditDialog record={record} decks={[]} onCancel={() => {}} onSave={() => {}} />
    );
    expect(screen.getByText('Atraxa')).toBeTruthy();
    expect(screen.getByText('Pick a deck')).toBeTruthy();
  });
});
