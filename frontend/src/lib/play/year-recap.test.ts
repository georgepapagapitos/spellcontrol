import { describe, expect, it } from 'vitest';
import { buildYearRecap, recapYears, type RecapGame } from './year-recap';

const at = (iso: string) => new Date(iso).getTime();

function g(
  id: string,
  endedAt: string,
  winnerSeat: number | null,
  durationMin: number,
  decks: Array<[name: string, deckId: string | null]>,
  format = 'commander'
): RecapGame {
  return {
    id,
    format,
    endedAt: at(endedAt),
    durationMs: durationMin * 60_000,
    winnerSeat,
    seats: decks.map(([name, deckId], seat) => ({ seat, name, deckId, deckName: deckId })),
  };
}

describe('year recap', () => {
  const games: RecapGame[] = [
    // Atraxa plays six decided games and wins four; Korvold plays two and wins both.
    ...[0, 0, 0, 0, 1, 1].map((w, i) =>
      g(`a${i}`, `2026-03-0${i + 1}T12:00:00`, w, 60 + i, [
        ['Ann', 'atraxa'],
        ['Bo', 'edgar'],
      ])
    ),
    g('k1', '2026-04-01T12:00:00', 0, 200, [
      ['Cy', 'korvold'],
      ['Bo', 'edgar'],
    ]),
    g('k2', '2026-04-02T12:00:00', 0, 30, [
      ['Cy', 'korvold'],
      ['Bo', 'edgar'],
    ]),
    g('old', '2025-12-30T12:00:00', 0, 45, [
      ['Ann', 'atraxa'],
      ['Bo', 'edgar'],
    ]),
    g(
      'h',
      '2026-05-01T12:00:00',
      null,
      20,
      [
        ['Ann', 'atraxa'],
        ['Bo', 'edgar'],
      ],
      'horde'
    ),
  ];

  it('lists the years that hold games, newest first, ignoring horde', () => {
    expect(recapYears(games)).toEqual([2026, 2025]);
  });

  it('keeps to one year and leaves horde out of every figure', () => {
    const r = buildYearRecap(games, 2026);
    expect(r.games).toBe(8);
    expect(r.players).toBe(3);
  });

  it('ranks the most played decks and the longest games', () => {
    const r = buildYearRecap(games, 2026);
    expect(r.mostPlayed[0]).toMatchObject({ deckId: 'edgar', played: 8 });
    expect(r.longest[0]).toMatchObject({ id: 'k1', durationMs: 200 * 60_000, winnerName: 'Cy' });
  });

  it('shows a win rate only at the sample floor', () => {
    const r = buildYearRecap(games, 2026);
    // Korvold is 2-0 but under the floor: listed as played, never ranked by rate.
    expect(r.mostPlayed.find((d) => d.deckId === 'korvold')).toMatchObject({ wins: 2, rate: null });
    expect(r.bestRates.map((d) => d.deckId)).toEqual(['atraxa', 'edgar']);
    expect(r.bestRates[0]).toMatchObject({ deckId: 'atraxa', wins: 4, losses: 2 });
    expect(r.bestRates[0].rate).toBeCloseTo(4 / 6);
  });

  it('an empty year is an empty recap', () => {
    expect(buildYearRecap(games, 2019)).toMatchObject({
      games: 0,
      players: 0,
      mostPlayed: [],
      longest: [],
    });
  });
});
