/**
 * Cross-game aggregation over the per-game `summary` written at persist time.
 * Shared by the pod leaderboard and the friends head-to-head so the two can't
 * drift on what "first blood rate" or "KOs" mean.
 *
 * ## Rows without a summary are excluded, never counted as zero
 *
 * `game_results.summary` is nullable: rows written before the column existed
 * read as `null`. Every function here **skips** those games rather than
 * treating them as a game where nobody drew first blood and nobody got a KO —
 * otherwise a pod's whole pre-migration history would silently drag every rate
 * toward 0 and read as a fact. `ratedGames` is the honest denominator for
 * every count below, and is deliberately separate from the `played` total the
 * leaderboard already reports.
 *
 * KO credit inherits `summarizeGame`'s turn-marker heuristic and its caveat: a
 * pod that never passes turns produces no edges at all, which is why callers
 * must render an absent superlative as "—" and not as a zero.
 */

import type { GameSummary } from '@spellcontrol/game-core';
import type { GameResultParticipant } from './result-types';

/** The per-game shape these rollups need — satisfied by `PublicGameResult`. */
export interface RollupGame {
  participants: GameResultParticipant[];
  summary: GameSummary | null;
}

export interface PlayerRollup {
  /** Games with a summary *and* a seat for this player — the denominator. */
  ratedGames: number;
  /** Mean finishing position, over rated games where they got a placement. */
  avgPlacement: number | null;
  /** Games where they drew first blood (turn-marker credited). */
  firstBloodDrawn: number;
  /** Games where they *took* first blood. */
  firstBloodTaken: number;
  /** Eliminations credited to them. */
  kos: number;
  /** Times they were eliminated with credit going to someone else. */
  timesKilled: number;
}

/** One killer→victim tally across a set of games. */
export interface KillEdge {
  killerId: string;
  victimId: string;
  kos: number;
}

function seatOf(game: RollupGame, userId: string): number | null {
  const p = game.participants.find((x) => x.userId === userId);
  return p ? p.seat : null;
}

function userIdOfSeat(game: RollupGame, seat: number): string | null {
  return game.participants.find((x) => x.seat === seat)?.userId ?? null;
}

export function rollupForUser(games: RollupGame[], userId: string): PlayerRollup {
  let ratedGames = 0;
  let firstBloodDrawn = 0;
  let firstBloodTaken = 0;
  let kos = 0;
  let timesKilled = 0;
  const placements: number[] = [];

  for (const g of games) {
    if (!g.summary) continue;
    const seat = seatOf(g, userId);
    if (seat == null) continue;
    ratedGames++;

    const mine = g.summary.seats.find((s) => s.seat === seat);
    if (mine?.placement != null) placements.push(mine.placement);
    if (mine?.killedBySeat != null) timesKilled++;
    if (g.summary.firstBlood?.seat === seat) firstBloodTaken++;
    if (g.summary.firstBlood?.bySeat === seat) firstBloodDrawn++;
    kos += g.summary.seats.filter((s) => s.killedBySeat === seat).length;
  }

  return {
    ratedGames,
    avgPlacement:
      placements.length > 0 ? placements.reduce((a, b) => a + b, 0) / placements.length : null,
    firstBloodDrawn,
    firstBloodTaken,
    kos,
    timesKilled,
  };
}

/**
 * Killer→victim tallies across the given games, highest first. Guest seats
 * (no `userId`) and self-eliminations are excluded — neither is a rivalry.
 */
export function killEdges(games: RollupGame[]): KillEdge[] {
  const tally = new Map<string, KillEdge>();
  for (const g of games) {
    if (!g.summary) continue;
    for (const s of g.summary.seats) {
      if (s.killedBySeat == null) continue;
      const killerId = userIdOfSeat(g, s.killedBySeat);
      const victimId = userIdOfSeat(g, s.seat);
      if (!killerId || !victimId || killerId === victimId) continue;
      const key = `${killerId}>${victimId}`;
      const edge = tally.get(key);
      if (edge) edge.kos++;
      else tally.set(key, { killerId, victimId, kos: 1 });
    }
  }
  return [...tally.values()].sort((a, b) => b.kos - a.kos || a.killerId.localeCompare(b.killerId));
}
