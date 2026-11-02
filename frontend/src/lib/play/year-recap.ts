import { rateAboveFloor } from './deck-stats';

/** The slice of a finished game a recap reads; a pod's games and your own history both fit it. */
export interface RecapGame {
  id: string;
  format: string;
  endedAt: number;
  durationMs: number;
  winnerSeat: number | null;
  seats: Array<{
    seat: number;
    name: string;
    deckId: string | null;
    deckName: string | null;
  }>;
}

export interface RecapDeckLine {
  deckId: string;
  deckName: string;
  played: number;
  wins: number;
  losses: number;
  /** null while the deck has fewer than DECK_RATE_MIN_GAMES decided games. */
  rate: number | null;
}

export interface RecapPlayerLine {
  name: string;
  played: number;
  wins: number;
  losses: number;
  rate: number | null;
}

export interface RecapLongGame {
  id: string;
  endedAt: number;
  durationMs: number;
  format: string;
  winnerName: string | null;
  names: string[];
}

export interface YearRecap {
  year: number;
  games: number;
  /** Distinct players by name. */
  players: number;
  totalMs: number;
  mostPlayed: RecapDeckLine[];
  /** Decks at or over the floor, best rate first. Empty is the common case early on. */
  bestRates: RecapDeckLine[];
  playerRates: RecapPlayerLine[];
  longest: RecapLongGame[];
}

const TOP = 3;

/** Years that hold at least one game, newest first. */
export function recapYears(games: RecapGame[]): number[] {
  const years = new Set<number>();
  for (const g of games) if (g.format !== 'horde') years.add(new Date(g.endedAt).getFullYear());
  return [...years].sort((a, b) => b - a);
}

const bump = <T extends { played: number; wins: number; losses: number }>(
  row: T,
  winner: boolean,
  decided: boolean
) => {
  row.played += 1;
  if (decided) {
    if (winner) row.wins += 1;
    else row.losses += 1;
  }
};

/**
 * One year of a group's games, local to the games handed in: nothing here
 * reaches outside them. Horde is co-op (no winning seat), so it stays out of
 * every figure. A rate appears only at DECK_RATE_MIN_GAMES decided games.
 */
export function buildYearRecap(all: RecapGame[], year: number): YearRecap {
  const games = all.filter(
    (g) => g.format !== 'horde' && new Date(g.endedAt).getFullYear() === year
  );
  const decks = new Map<string, RecapDeckLine>();
  const players = new Map<string, RecapPlayerLine>();
  let totalMs = 0;

  for (const g of games) {
    totalMs += Math.max(0, g.durationMs);
    const decided = g.winnerSeat !== null;
    for (const s of g.seats) {
      const isWinner = g.winnerSeat === s.seat;
      // Players are keyed by lower-cased seat name: two different guests who share
      // a name merge, and a friend who also appears as a typed guest name splits.
      // Acceptable for a group-local recap with no cross-user identity.
      const pKey = s.name.trim().toLowerCase();
      const p = players.get(pKey) ?? {
        name: s.name,
        played: 0,
        wins: 0,
        losses: 0,
        rate: null,
      };
      bump(p, isWinner, decided);
      players.set(pKey, p);
      if (!s.deckId) continue;
      const d = decks.get(s.deckId) ?? {
        deckId: s.deckId,
        deckName: s.deckName ?? 'Untitled deck',
        played: 0,
        wins: 0,
        losses: 0,
        rate: null,
      };
      bump(d, isWinner, decided);
      decks.set(s.deckId, d);
    }
  }

  const withRate = <T extends RecapDeckLine | RecapPlayerLine>(rows: Iterable<T>): T[] =>
    [...rows].map((r) => ({ ...r, rate: rateAboveFloor(r.wins, r.losses) }));
  const deckRows = withRate(decks.values());
  const playerRows = withRate(players.values());

  const byPlayed = (a: { played: number; wins: number }, b: { played: number; wins: number }) =>
    b.played - a.played || b.wins - a.wins;
  const byRate = (
    a: { rate: number | null; played: number },
    b: { rate: number | null; played: number }
  ) => (b.rate ?? 0) - (a.rate ?? 0) || b.played - a.played;

  return {
    year,
    games: games.length,
    players: players.size,
    totalMs,
    mostPlayed: [...deckRows].sort(byPlayed).slice(0, TOP),
    bestRates: deckRows
      .filter((d) => d.rate !== null)
      .sort(byRate)
      .slice(0, TOP),
    playerRates: playerRows
      .filter((p) => p.rate !== null)
      .sort(byRate)
      .slice(0, TOP * 2),
    longest: games
      .filter((g) => g.durationMs > 0)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, TOP)
      .map((g) => ({
        id: g.id,
        endedAt: g.endedAt,
        durationMs: g.durationMs,
        format: g.format,
        winnerName: g.seats.find((s) => s.seat === g.winnerSeat)?.name ?? null,
        names: g.seats.map((s) => s.name),
      })),
  };
}
