import { describe, expect, it } from 'vitest';
import { aggregateMatchupRecords } from './matchup-records';
import type { GameRecord } from '@/lib/game-state';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function player(
  seat: number,
  deckId: string | null,
  opts: { userId?: string | null; name?: string; deckName?: string } = {}
) {
  return {
    seat,
    userId: opts.userId ?? null,
    name: opts.name ?? `Player${seat}`,
    deckId,
    deckName: deckId ? (opts.deckName ?? `Deck-${deckId}`) : null,
    commander: null,
    finalLife: 20,
    eliminated: false,
  };
}

function game(
  id: string,
  players: ReturnType<typeof player>[],
  winnerSeat: number | null,
  mode: 'local' | 'online' = 'local',
  endedAt = 1000
): GameRecord {
  return {
    id,
    code: id,
    format: 'commander',
    startingLife: 40,
    startedAt: endedAt - 60000,
    endedAt,
    durationMs: 60000,
    winnerSeat,
    mode,
    players,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('aggregateMatchupRecords', () => {
  it('returns empty array for no records', () => {
    expect(aggregateMatchupRecords([], null)).toEqual([]);
  });

  it('two-player online game where deckA wins — includes pair for matching userId', () => {
    const rec = game(
      'g1',
      [player(0, 'd1', { userId: 'u1' }), player(1, 'd2', { userId: 'u2' })],
      0, // seat 0 (d1) wins
      'online'
    );
    const rows = aggregateMatchupRecords([rec], 'u1');
    expect(rows).toHaveLength(1);
    // canonical: d1 < d2 lexicographically, so d1 = A
    expect(rows[0].deckAId).toBe('d1');
    expect(rows[0].deckBId).toBe('d2');
    expect(rows[0].wins).toBe(1);
    expect(rows[0].losses).toBe(0);
    expect(rows[0].played).toBe(1);
    expect(rows[0].winRate).toBe(1.0);
  });

  it('two-player online game where deckB wins', () => {
    const rec = game(
      'g1',
      [player(0, 'd1', { userId: 'u1' }), player(1, 'd2', { userId: 'u2' })],
      1, // seat 1 (d2) wins → from d1's perspective: loss
      'online'
    );
    const rows = aggregateMatchupRecords([rec], 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(0);
    expect(rows[0].losses).toBe(1);
    expect(rows[0].played).toBe(1);
    expect(rows[0].winRate).toBe(0);
  });

  it('online game where userId matches neither player — returns empty', () => {
    const rec = game(
      'g1',
      [player(0, 'd1', { userId: 'u1' }), player(1, 'd2', { userId: 'u2' })],
      0,
      'online'
    );
    const rows = aggregateMatchupRecords([rec], 'u99');
    expect(rows).toHaveLength(0);
  });

  it('local game includes all pairs regardless of userId', () => {
    const rec = game(
      'g1',
      [player(0, 'd1', { userId: null }), player(1, 'd2', { userId: null })],
      0,
      'local'
    );
    const rows = aggregateMatchupRecords([rec], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].played).toBe(1);
  });

  it('two games between same pair with opposite winners — correct tallies', () => {
    const records: GameRecord[] = [
      game('g1', [player(0, 'd1', { userId: null }), player(1, 'd2', { userId: null })], 0),
      game('g2', [player(0, 'd1', { userId: null }), player(1, 'd2', { userId: null })], 1),
    ];
    const rows = aggregateMatchupRecords(records, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(1);
    expect(rows[0].losses).toBe(1);
    expect(rows[0].played).toBe(2);
    expect(rows[0].winRate).toBe(0.5);
  });

  it('draw game — played increments, wins/losses stay 0, winRate = 0', () => {
    const rec = game(
      'g1',
      [player(0, 'd1', { userId: null }), player(1, 'd2', { userId: null })],
      null // draw
    );
    const rows = aggregateMatchupRecords([rec], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].wins).toBe(0);
    expect(rows[0].losses).toBe(0);
    expect(rows[0].played).toBe(1);
    expect(rows[0].winRate).toBe(0);
  });

  it('player with null deckId is excluded from pair generation', () => {
    const rec = game(
      'g1',
      [
        player(0, null, { userId: null }), // no deck
        player(1, 'd2', { userId: null }),
        player(2, 'd3', { userId: null }),
      ],
      1 // seat 1 wins
    );
    const rows = aggregateMatchupRecords([rec], null);
    // Only d2 vs d3 is a valid pair; seat 0 (null deckId) skips
    expect(rows).toHaveLength(1);
    expect(rows[0].deckAId).toBe('d2');
    expect(rows[0].deckBId).toBe('d3');
  });

  it('4-player pod produces 6 rows (C(4,2))', () => {
    const rec = game(
      'g1',
      [
        player(0, 'd1', { userId: null }),
        player(1, 'd2', { userId: null }),
        player(2, 'd3', { userId: null }),
        player(3, 'd4', { userId: null }),
      ],
      0 // seat 0 wins
    );
    const rows = aggregateMatchupRecords([rec], null);
    expect(rows).toHaveLength(6);
  });

  it('4-player online pod — only the calling user’s own matchups, not opponent-vs-opponent', () => {
    const rec = game(
      'g1',
      [
        player(0, 'd1', { userId: 'u1' }),
        player(1, 'd2', { userId: 'u2' }),
        player(2, 'd3', { userId: 'u3' }),
        player(3, 'd4', { userId: 'u4' }),
      ],
      0, // u1 (d1) wins
      'online'
    );
    const rows = aggregateMatchupRecords([rec], 'u1');
    // u1 took part in 3 of the 6 pairs: d1|d2, d1|d3, d1|d4 — not d2|d3, d2|d4, d3|d4.
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deckAId === 'd1' || r.deckBId === 'd1')).toBe(true);
    // d1 won all three.
    expect(rows.every((r) => r.deckAId === 'd1' && r.wins === 1 && r.losses === 0)).toBe(true);
  });

  it('key canonicalization — swapped seat order produces one merged row', () => {
    // Game 1: d1 at seat 0, d2 at seat 1
    const g1 = game(
      'g1',
      [player(0, 'd1', { userId: null }), player(1, 'd2', { userId: null })],
      0
    );
    // Game 2: d2 at seat 0, d1 at seat 1
    const g2 = game(
      'g2',
      [player(0, 'd2', { userId: null }), player(1, 'd1', { userId: null })],
      0
    );
    const rows = aggregateMatchupRecords([g1, g2], null);
    // Both games share the same canonical key d1|d2
    expect(rows).toHaveLength(1);
    expect(rows[0].played).toBe(2);
  });

  it('sorting: most-played first; equal-played sorted by winRate descending', () => {
    // d1 vs d2: 3 games
    const pair12: GameRecord[] = [
      game('a1', [player(0, 'd1'), player(1, 'd2')], 0, 'local', 1000),
      game('a2', [player(0, 'd1'), player(1, 'd2')], 0, 'local', 2000),
      game('a3', [player(0, 'd1'), player(1, 'd2')], 0, 'local', 3000),
    ];
    // d3 vs d4: 2 games, 100% winRate for d3
    const pair34: GameRecord[] = [
      game('b1', [player(0, 'd3'), player(1, 'd4')], 0, 'local', 1000),
      game('b2', [player(0, 'd3'), player(1, 'd4')], 0, 'local', 2000),
    ];
    // d5 vs d6: 2 games, 50% winRate
    const pair56: GameRecord[] = [
      game('c1', [player(0, 'd5'), player(1, 'd6')], 0, 'local', 1000),
      game('c2', [player(0, 'd5'), player(1, 'd6')], 1, 'local', 2000),
    ];
    const rows = aggregateMatchupRecords([...pair12, ...pair34, ...pair56], null);
    // First: d1 vs d2 (most played: 3)
    expect(rows[0].played).toBe(3);
    // Second: d3 vs d4 (2 played, 100% winRate) beats d5 vs d6 (2 played, 50%)
    expect(rows[1].deckAId).toBe('d3');
    expect(rows[2].deckAId).toBe('d5');
  });

  it('lastPlayedAt is the most recent game endedAt in the matchup', () => {
    const records: GameRecord[] = [
      game('g1', [player(0, 'd1'), player(1, 'd2')], 0, 'local', 1000),
      game('g2', [player(0, 'd1'), player(1, 'd2')], 0, 'local', 5000),
    ];
    const rows = aggregateMatchupRecords(records, null);
    expect(rows[0].lastPlayedAt).toBe(5000);
  });
});
