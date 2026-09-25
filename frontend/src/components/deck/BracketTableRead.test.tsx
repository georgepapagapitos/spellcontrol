// @vitest-environment happy-dom
/**
 * BracketTableRead — the Bracket panel's "At the table": no games, too few to
 * read, and a read against an even share of wins.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { GameRecord } from '@/lib/game-state';

let history: GameRecord[] = [];

vi.mock('../../store/play', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/play')>();
  return {
    ...actual,
    usePlayStore: <T,>(selector: (s: { history: GameRecord[] }) => T): T => selector({ history }),
  };
});

vi.mock('../../store/auth', () => ({
  useAuth: <T,>(selector: (s: { user: { id: string } | null }) => T): T => selector({ user: null }),
}));

import { BracketTableRead } from './BracketTableRead';

let seq = 0;
/** A local four-player game with deck-1 in seat 0. */
function game(won: boolean): GameRecord {
  seq += 1;
  return {
    id: `g-${seq}`,
    code: 'ABCD',
    format: 'commander',
    startingLife: 40,
    players: [0, 1, 2, 3].map((seat) => ({
      seat,
      userId: null,
      name: `P${seat}`,
      deckId: seat === 0 ? 'deck-1' : null,
      deckName: null,
      commander: null,
      finalLife: 0,
      eliminated: false,
    })),
    winnerSeat: won ? 0 : 1,
    startedAt: null,
    endedAt: Date.now(),
    durationMs: 0,
    mode: 'local',
  };
}

function renderRead() {
  return render(
    <MemoryRouter>
      <BracketTableRead deckId="deck-1" />
    </MemoryRouter>
  );
}

describe('BracketTableRead', () => {
  it('offers to track a game when there are none', () => {
    history = [];
    renderRead();
    expect(screen.getByText(/No tracked games with this deck\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Track a game/ }).getAttribute('href')).toBe('/play');
  });

  it('gives no read below ten games, and says how many more it needs', () => {
    history = [game(true), game(true), game(false)];
    renderRead();
    expect(screen.getByText('2 wins in 3 games')).toBeTruthy();
    expect(screen.getByText(/Too few games to say much\. 7 more games give a read\./)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('reads above an even share with the even share marked', () => {
    history = [
      ...Array.from({ length: 7 }, () => game(true)),
      game(false),
      game(false),
      game(false),
    ];
    renderRead();
    expect(screen.getByText('7 wins in 10 games')).toBeTruthy();
    expect(screen.getByText('an even share is 2.5')).toBeTruthy();
    expect(screen.getByText(/It wins much more than an even share/)).toBeTruthy();
  });
});
