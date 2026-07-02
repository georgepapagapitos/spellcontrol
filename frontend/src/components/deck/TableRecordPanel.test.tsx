// @vitest-environment happy-dom
/**
 * TableRecordPanel — this deck's real tracked W/L (Stats tab). Exercises the
 * empty state, a populated W/L summary, the "no winner" (undecided) case, and
 * the top-3 head-to-head truncation + opponent-side win/loss swap.
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

import { TableRecordPanel } from './TableRecordPanel';

let seq = 0;
function mkGame(over: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    id: `g-${seq}`,
    code: 'ABCD',
    format: 'commander',
    startingLife: 40,
    players: [],
    winnerSeat: null,
    startedAt: null,
    endedAt: Date.now(),
    durationMs: 0,
    mode: 'local',
    ...over,
  };
}

function renderPanel(deckId = 'deck-1') {
  return render(
    <MemoryRouter>
      <TableRecordPanel deckId={deckId} />
    </MemoryRouter>
  );
}

describe('TableRecordPanel', () => {
  it('shows an invitation empty state with no tracked games', () => {
    history = [];
    renderPanel();
    expect(screen.getByText('No games tracked yet.')).toBeTruthy();
    const link = screen.getByRole('link', { name: /track a game/i });
    expect(link.getAttribute('href')).toBe('/play');
  });

  it('summarizes wins/losses for the deck', () => {
    history = [
      mkGame({
        players: [
          {
            seat: 0,
            userId: null,
            name: 'Me',
            deckId: 'deck-1',
            deckName: 'My Deck',
            commander: null,
            finalLife: 1,
            eliminated: false,
          },
          {
            seat: 1,
            userId: null,
            name: 'Opp',
            deckId: 'deck-2',
            deckName: 'Opp Deck',
            commander: null,
            finalLife: 0,
            eliminated: true,
          },
        ],
        winnerSeat: 0,
      }),
    ];
    renderPanel();
    expect(screen.getByText(/1 game/)).toBeTruthy();
    expect(screen.getByText(/1W–0L/)).toBeTruthy();
    expect(screen.getByText(/100% win rate/)).toBeTruthy();
    expect(screen.getByText('Opp Deck')).toBeTruthy();
  });

  it('surfaces a no-winner game as undecided, not silently dropped', () => {
    history = [
      mkGame({
        players: [
          {
            seat: 0,
            userId: null,
            name: 'Me',
            deckId: 'deck-1',
            deckName: 'My Deck',
            commander: null,
            finalLife: 20,
            eliminated: false,
          },
          {
            seat: 1,
            userId: null,
            name: 'Opp',
            deckId: 'deck-2',
            deckName: 'Opp Deck',
            commander: null,
            finalLife: 20,
            eliminated: false,
          },
        ],
        winnerSeat: null,
      }),
    ];
    renderPanel();
    expect(screen.getByText(/0W–0L/)).toBeTruthy();
    expect(screen.getByText(/1 no winner/)).toBeTruthy();
  });

  it('shows only the top 3 opponent matchups, swapping the score for the B-side deck', () => {
    // deck-2 played 4x (most), deck-3 3x, deck-4 2x, deck-5 1x (dropped).
    const counts: [string, number][] = [
      ['deck-2', 4],
      ['deck-3', 3],
      ['deck-4', 2],
      ['deck-5', 1],
    ];
    history = counts.flatMap(([oppId, n]) =>
      Array.from({ length: n }, () =>
        mkGame({
          players: [
            {
              seat: 0,
              userId: null,
              name: 'Opp',
              deckId: oppId,
              deckName: `Deck ${oppId}`,
              commander: null,
              finalLife: 20,
              eliminated: false,
            },
            {
              seat: 1,
              userId: null,
              name: 'Me',
              deckId: 'deck-1',
              deckName: 'My Deck',
              commander: null,
              finalLife: 1,
              eliminated: false,
            },
          ],
          // Deck-1 sits at seat 1 and always wins — exercises the B-side
          // (deckAId !== deckId) win/loss swap in the matchup row.
          winnerSeat: 1,
        })
      )
    );
    renderPanel();
    expect(screen.getByText('Deck deck-2')).toBeTruthy();
    expect(screen.getByText('Deck deck-3')).toBeTruthy();
    expect(screen.getByText('Deck deck-4')).toBeTruthy();
    expect(screen.queryByText('Deck deck-5')).toBeNull();
    // deck-1 (B-side, lexicographically after deck-2..5) went 4-0 vs deck-2.
    expect(screen.getByText('4–0')).toBeTruthy();
  });
});
