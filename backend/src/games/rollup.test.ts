import { describe, it, expect } from 'vitest';
import { killEdges, rollupForUser, type RollupGame } from './rollup';
import type { GameSummary, SeatSummary } from '@spellcontrol/game-core';
import type { GameResultParticipant } from './result-types';

function participant(seat: number, userId: string | null): GameResultParticipant {
  return {
    seat,
    userId,
    username: userId,
    name: userId ?? `Guest ${seat}`,
    deckId: null,
    deckName: null,
    commander: null,
    colorIdentity: [],
    finalLife: 0,
    eliminated: false,
  };
}

function seatSummary(seat: number, over: Partial<SeatSummary> = {}): SeatSummary {
  return {
    seat,
    damageTaken: 0,
    lifeGained: 0,
    biggestHit: 0,
    lowestLife: 40,
    commanderDamageDealt: 0,
    placement: null,
    eliminatedOnTurn: null,
    killedBySeat: null,
    ...over,
  };
}

/** A game where seat N belongs to `users[N]` (null = a guest seat). */
function game(users: (string | null)[], summary: GameSummary | null): RollupGame {
  return { participants: users.map((u, seat) => participant(seat, u)), summary };
}

function summary(seats: SeatSummary[], over: Partial<GameSummary> = {}): GameSummary {
  return {
    turns: 4,
    durationMs: 60_000,
    firstBlood: null,
    startingSeat: null,
    winnerSeat: null,
    seats,
    commanderDamage: [],
    ...over,
  };
}

describe('rollupForUser', () => {
  it('excludes summary-less games from every count, rather than scoring them zero', () => {
    const games = [
      game(['a', 'b'], null), // pre-migration row
      game(
        ['a', 'b'],
        summary([seatSummary(0, { placement: 1 }), seatSummary(1, { placement: 2 })], {
          firstBlood: { seat: 1, bySeat: 0, turn: 3, ts: 1, amount: 6 },
        })
      ),
    ];
    const a = rollupForUser(games, 'a');
    expect(a.ratedGames).toBe(1); // NOT 2
    expect(a.avgPlacement).toBe(1);
    expect(a.firstBloodDrawn).toBe(1);
  });

  it('skips games the player did not sit in', () => {
    const games = [game(['a', 'b'], summary([seatSummary(0), seatSummary(1)]))];
    expect(rollupForUser(games, 'c').ratedGames).toBe(0);
  });

  it('averages placement only over games that produced one', () => {
    const games = [
      game(['a', 'b'], summary([seatSummary(0, { placement: 1 }), seatSummary(1)])),
      game(['a', 'b'], summary([seatSummary(0, { placement: 3 }), seatSummary(1)])),
      game(['a', 'b'], summary([seatSummary(0), seatSummary(1)])), // still in progress
    ];
    const a = rollupForUser(games, 'a');
    expect(a.ratedGames).toBe(3);
    expect(a.avgPlacement).toBe(2); // mean of 1 and 3 — the third doesn't dilute it
    expect(rollupForUser(games, 'b').avgPlacement).toBeNull();
  });

  it('separates first blood drawn from first blood taken', () => {
    const games = [
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], {
          firstBlood: { seat: 1, bySeat: 0, turn: 2, ts: 1, amount: 4 },
        })
      ),
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], {
          firstBlood: { seat: 0, bySeat: 1, turn: 2, ts: 1, amount: 4 },
        })
      ),
    ];
    const a = rollupForUser(games, 'a');
    expect(a.firstBloodDrawn).toBe(1);
    expect(a.firstBloodTaken).toBe(1);
  });

  it('counts on-the-play starts and the wins from them', () => {
    const games = [
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], { startingSeat: 0, winnerSeat: 0 })
      ),
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], { startingSeat: 0, winnerSeat: 1 })
      ),
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], { startingSeat: 1, winnerSeat: 1 })
      ),
    ];
    const a = rollupForUser(games, 'a');
    expect(a.onThePlayGames).toBe(3);
    expect(a.wentFirst).toBe(2);
    expect(a.wonGoingFirst).toBe(1); // the start b converted doesn't count for a
    const b = rollupForUser(games, 'b');
    expect(b.wentFirst).toBe(1);
    expect(b.wonGoingFirst).toBe(1);
  });

  it('excludes games with no recorded first player from the on-the-play denominator', () => {
    const games = [
      game(
        ['a', 'b'],
        summary([seatSummary(0), seatSummary(1)], { startingSeat: 0, winnerSeat: 0 })
      ),
      // Summary present in every other respect — the pod just never tapped the
      // first-player tool. Counting this as "didn't go first" would assert
      // something the data doesn't say.
      game(['a', 'b'], summary([seatSummary(0), seatSummary(1)], { winnerSeat: 1 })),
      game(['a', 'b'], null), // pre-migration row: excluded from everything
    ];
    const a = rollupForUser(games, 'a');
    expect(a.ratedGames).toBe(2); // both summary-carrying games
    expect(a.onThePlayGames).toBe(1); // but only one recorded a first player
    expect(a.wentFirst).toBe(1);
    expect(a.wonGoingFirst).toBe(1);
  });

  it('counts KOs credited to the player and times the player was KO’d', () => {
    const games = [
      game(
        ['a', 'b', 'c'],
        summary([
          seatSummary(0),
          seatSummary(1, { killedBySeat: 0 }),
          seatSummary(2, { killedBySeat: 0 }),
        ])
      ),
      game(
        ['a', 'b', 'c'],
        summary([seatSummary(0, { killedBySeat: 2 }), seatSummary(1), seatSummary(2)])
      ),
    ];
    expect(rollupForUser(games, 'a').kos).toBe(2);
    expect(rollupForUser(games, 'a').timesKilled).toBe(1);
    expect(rollupForUser(games, 'c').kos).toBe(1);
    expect(rollupForUser(games, 'b').kos).toBe(0);
  });
});

describe('killEdges', () => {
  it('tallies killer→victim pairs across games, highest first', () => {
    const games = [
      game(
        ['a', 'b', 'c'],
        summary([seatSummary(0), seatSummary(1, { killedBySeat: 0 }), seatSummary(2)])
      ),
      game(
        ['a', 'b', 'c'],
        summary([seatSummary(0), seatSummary(1, { killedBySeat: 0 }), seatSummary(2)])
      ),
      game(
        ['a', 'b', 'c'],
        summary([seatSummary(0), seatSummary(1), seatSummary(2, { killedBySeat: 1 })])
      ),
    ];
    expect(killEdges(games)).toEqual([
      { killerId: 'a', victimId: 'b', kos: 2 },
      { killerId: 'b', victimId: 'c', kos: 1 },
    ]);
  });

  it('ignores guest seats and summary-less games — neither is a rivalry', () => {
    const games = [
      game([null, 'b'], summary([seatSummary(0), seatSummary(1, { killedBySeat: 0 })])), // guest killer
      game(['a', null], summary([seatSummary(0), seatSummary(1, { killedBySeat: 0 })])), // guest victim
      game(['a', 'b'], null),
    ];
    expect(killEdges(games)).toEqual([]);
  });

  it('never records a self-kill as a rivalry', () => {
    // A seat mapped to the same account twice can't be an archenemy of itself.
    const games = [
      game(['a', 'a'], summary([seatSummary(0), seatSummary(1, { killedBySeat: 0 })])),
    ];
    expect(killEdges(games)).toEqual([]);
  });

  it('returns nothing when the pod never passes turns (no KO credit at all)', () => {
    const games = [game(['a', 'b'], summary([seatSummary(0), seatSummary(1)], { turns: 0 }))];
    expect(killEdges(games)).toEqual([]);
  });
});
