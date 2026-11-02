// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { YearRecap } from './YearRecap';
import type { RecapGame } from '@/lib/play/year-recap';

afterEach(cleanup);

const game = (id: string, iso: string, win: number | null, min: number): RecapGame => ({
  id,
  format: 'commander',
  endedAt: new Date(iso).getTime(),
  durationMs: min * 60_000,
  winnerSeat: win,
  seats: [
    { seat: 0, name: 'Ann', deckId: 'atraxa', deckName: 'Atraxa' },
    { seat: 1, name: 'Bo', deckId: 'edgar', deckName: 'Edgar' },
  ],
});

describe('YearRecap', () => {
  it('renders nothing without games', () => {
    const { container } = render(<YearRecap games={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('keeps a rate out of sight until the sample floor, and says why', () => {
    render(<YearRecap games={[game('1', '2026-02-01T12:00:00', 0, 70)]} />);
    const best = screen.getByRole('region', { name: 'Best win rates' });
    expect(within(best).getByText(/once a deck or player has 5 games/)).toBeTruthy();
    const most = screen.getByRole('region', { name: 'Most played decks' });
    expect(within(most).queryByText('100%')).toBeNull();
  });

  it('shows rates at the floor and the longest game', () => {
    const games = [0, 0, 0, 1, 0].map((w, i) => game(`g${i}`, '2026-02-01T12:00:00', w, 60 + i));
    render(<YearRecap games={games} capNote="Counts the pod's 200 most recent games." />);
    const best = screen.getByRole('region', { name: 'Best win rates' });
    expect(within(best).getAllByText(/80% over 5/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Longest games' }).textContent).toContain('1h 4m');
    expect(screen.getByText(/200 most recent games/)).toBeTruthy();
  });

  it('switches year from the picker', () => {
    render(
      <YearRecap
        games={[game('a', '2026-02-01T12:00:00', 0, 10), game('b', '2025-02-01T12:00:00', 0, 99)]}
      />
    );
    expect(screen.getByRole('region', { name: 'Year in review 2026' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /year/i }));
    fireEvent.click(screen.getByRole('option', { name: '2025' }));
    expect(screen.getByRole('region', { name: 'Year in review 2025' })).toBeTruthy();
  });
});
