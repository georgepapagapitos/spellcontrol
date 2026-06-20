import type { GameRecord } from '@/lib/game-state';

export interface MatchupRow {
  /** Lexicographically-first deckId in the pair (canonical A slot). */
  deckAId: string;
  deckAName: string;
  /** Lexicographically-second deckId (canonical B slot). */
  deckBId: string;
  deckBName: string;
  /** Games where deckA beat deckB. */
  wins: number;
  /** Games where deckB beat deckA. */
  losses: number;
  /** Total co-appearances including draws. */
  played: number;
  /** wins / (wins + losses), 0 when no decided games exist. */
  winRate: number;
  /** Epoch ms of most recent shared game. */
  lastPlayedAt: number;
}

interface MatchupAccum {
  deckAId: string;
  deckAName: string;
  deckBId: string;
  deckBName: string;
  wins: number;
  losses: number;
  played: number;
  lastPlayedAt: number;
}

/**
 * Aggregate head-to-head matchup records across all deck pairs seen in
 * `records`. Each unordered pair (deckA, deckB) collapses into one row
 * regardless of which seat held which deck in any given game.
 *
 * Attribution: for online games, skip any pair where neither player's userId
 * matches the calling userId — mirrors aggregateDeckRecords at store/play.ts.
 * For local games (mode === 'local') all pairs are included unconditionally.
 */
export function aggregateMatchupRecords(
  records: GameRecord[],
  userId: string | null
): MatchupRow[] {
  const byPair = new Map<string, MatchupAccum>();

  for (const rec of records) {
    // Collect players that have a deckId.
    const players = rec.players.filter((p) => p.deckId != null);

    // For online games collect the set of userIds present, to check attribution.
    const userIds = new Set(rec.players.map((p) => p.userId));
    const isOnline = rec.mode === 'online';

    // Generate every unordered pair.
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const pa = players[i];
        const pb = players[j];

        // For online games, skip pairs where the current user was not present.
        if (isOnline && !userIds.has(userId)) continue;

        // Canonical ordering: lexicographically-lesser deckId is always A.
        const [aPlayer, bPlayer] = pa.deckId! < pb.deckId! ? [pa, pb] : [pb, pa];

        const key = `${aPlayer.deckId}|${bPlayer.deckId}`;

        const cur = byPair.get(key) ?? {
          deckAId: aPlayer.deckId!,
          deckAName: aPlayer.deckName ?? 'Untitled deck',
          deckBId: bPlayer.deckId!,
          deckBName: bPlayer.deckName ?? 'Untitled deck',
          wins: 0,
          losses: 0,
          played: 0,
          lastPlayedAt: 0,
        };

        cur.played += 1;
        cur.lastPlayedAt = Math.max(cur.lastPlayedAt, rec.endedAt);

        if (rec.winnerSeat !== null) {
          if (rec.winnerSeat === aPlayer.seat) cur.wins += 1;
          else if (rec.winnerSeat === bPlayer.seat) cur.losses += 1;
          // winnerSeat matched neither of this pair (another player won) — no win/loss
        }

        byPair.set(key, cur);
      }
    }
  }

  const rows: MatchupRow[] = Array.from(byPair.values()).map((r) => {
    const decided = r.wins + r.losses;
    return {
      ...r,
      winRate: decided > 0 ? r.wins / decided : 0,
    };
  });

  rows.sort((a, b) => b.played - a.played || b.winRate - a.winRate);
  return rows;
}
