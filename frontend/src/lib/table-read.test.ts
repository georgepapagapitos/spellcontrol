import { describe, expect, it } from 'vitest';
import type { GameRecord } from '@/lib/game-state';
import { deckTableRead, seatCountsForDeck } from './table-read';

let n = 0;
/** A finished game: `deckSeat` holds the deck, `pod` seats in all. */
function game(won: boolean, over: Partial<GameRecord> = {}, pod = 4, deckSeat = 0): GameRecord {
  const players = Array.from({ length: pod }, (_, seat) => ({
    seat,
    userId: seat === deckSeat ? 'me' : `other-${seat}`,
    name: `P${seat}`,
    deckId: seat === deckSeat ? 'deck-1' : null,
    deckName: null,
    commander: null,
    finalLife: 0,
    eliminated: false,
  }));
  return {
    id: `g${n++}`,
    code: 'X',
    format: 'commander',
    startingLife: 40,
    players,
    winnerSeat: won ? deckSeat : (deckSeat + 1) % pod,
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    mode: 'local',
    ...over,
  } as GameRecord;
}

const games = (wins: number, losses: number, pod = 4) => [
  ...Array.from({ length: wins }, () => game(true, {}, pod)),
  ...Array.from({ length: losses }, () => game(false, {}, pod)),
];

describe('deckTableRead', () => {
  it('reads above at twice an even share over 10+ games', () => {
    const r = deckTableRead(games(7, 3), 'me', 'deck-1');
    expect(r).toMatchObject({ games: 10, wins: 7, verdict: 'above' });
    expect(r.evenShare).toBeCloseTo(2.5);
  });

  it('reads even near a fair share, and below at half or less', () => {
    expect(deckTableRead(games(3, 9), 'me', 'deck-1').verdict).toBe('even');
    expect(deckTableRead(games(1, 11), 'me', 'deck-1').verdict).toBe('below');
  });

  it('says nothing below 10 decided games', () => {
    expect(deckTableRead(games(3, 0), 'me', 'deck-1')).toMatchObject({
      games: 3,
      wins: 3,
      verdict: null,
    });
  });

  it('weighs each game by its pod size', () => {
    // Ten two-player games: an even share is 5, so 6 wins is fair.
    const r = deckTableRead(games(6, 4, 2), 'me', 'deck-1');
    expect(r.evenShare).toBeCloseTo(5);
    expect(r.verdict).toBe('even');
  });

  it('skips undecided games and horde', () => {
    const r = deckTableRead(
      [game(true, { winnerSeat: null }), game(true, { format: 'horde' } as Partial<GameRecord>)],
      'me',
      'deck-1'
    );
    expect(r.games).toBe(0);
  });
});

describe('seatCountsForDeck', () => {
  it("counts only the viewer's own seat online, every seat locally", () => {
    const online = game(true, { mode: 'online' });
    expect(seatCountsForDeck(online, online.players[0], 'me')).toBe(true);
    expect(seatCountsForDeck(online, online.players[0], 'someone-else')).toBe(false);
    const local = game(true);
    expect(seatCountsForDeck(local, local.players[0], 'someone-else')).toBe(true);
    expect(seatCountsForDeck(local, local.players[1], 'me')).toBe(false); // no deck
  });
});
