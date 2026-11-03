import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGameState,
  gameToRecord,
  makePlayer,
  TWO_HEADED_GIANT_LIFE,
  type GameFormat,
  type GameRecord,
} from '@spellcontrol/game-core';
import { aggregateDeckRecords } from '@/store/play';
import { deckOutcomes } from './deck-outcomes';
import { deckPilots } from './deck-stats';
import { aggregateMatchupRecords } from './matchup-records';
import { deckTableRead } from './table-read';
import { buildYearRecap } from './year-recap';

/**
 * A real four-seat table played through the reducer: seats 0+1 are one team,
 * 2+3 the other, and the team that is knocked out loses. The reducer names the
 * surviving team's lowest seat as `winnerSeat`; every stat must still credit
 * both teammates.
 */
function finishedTable(format: GameFormat, loserSeat: number): GameRecord {
  const lobby = createGameState({
    id: `g-${format}-${loserSeat}`,
    code: 'ABCD',
    mode: 'local',
    hostUserId: null,
    format,
    startingLife: format === '2hg' ? TWO_HEADED_GIANT_LIFE : 40,
    commanderDamageEnabled: false,
    poisonEnabled: true,
    players: Array.from({ length: 4 }, (_, i) =>
      makePlayer({
        id: `p${i}`,
        userId: null,
        seat: i,
        name: `P${i}`,
        deckId: `d${i}`,
        deckName: `Deck ${i}`,
        deckVersion: 'v1',
        startingLife: format === '2hg' ? TWO_HEADED_GIANT_LIFE : 40,
      })
    ),
    ts: 1000,
  });
  let s = applyAction(lobby, { type: 'start', ts: 1001 });
  s = applyAction(s, {
    type: 'life',
    seat: loserSeat,
    delta: -100,
    actorSeat: loserSeat,
    ts: 2000,
  });
  if (format !== '2hg') {
    // Free-for-all: knock the other two out as well so one seat survives.
    for (const seat of [1, 2, 3].filter((x) => x !== loserSeat && x !== 0)) {
      s = applyAction(s, { type: 'life', seat, delta: -100, actorSeat: seat, ts: 2001 });
    }
  }
  expect(s.status).toBe('finished');
  return gameToRecord(s, 3000);
}

const asDeck = (rec: GameRecord, seat: number) =>
  aggregateDeckRecords([rec], null).find((r) => r.deckId === `d${seat}`)!;

describe('Two-Headed Giant results credit the whole team', () => {
  const rec = finishedTable('2hg', 2); // team 1 (seats 2, 3) is out; team 0 wins

  it('the reducer stamps only the lowest winning seat', () => {
    expect(rec.winnerSeat).toBe(0);
  });

  it('deck records: each teammate deck gets a win, each losing deck a loss', () => {
    expect([0, 1].map((s) => [asDeck(rec, s).wins, asDeck(rec, s).losses])).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect([2, 3].map((s) => [asDeck(rec, s).wins, asDeck(rec, s).losses])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('pilot rows, table read and deck outcomes agree', () => {
    expect(deckPilots([rec], 'd1', null)[0]).toMatchObject({ wins: 1, losses: 0 });
    expect(deckPilots([rec], 'd3', null)[0]).toMatchObject({ wins: 0, losses: 1 });
    expect(deckTableRead([rec], null, 'd1')).toMatchObject({ games: 1, wins: 1 });
    expect(deckOutcomes([rec], null, 'd1', 'v1').current.wins).toBe(1);
    expect(deckOutcomes([rec], null, 'd3', 'v1').current.wins).toBe(0);
  });

  it('head-to-head: a winner beats each opposing deck; teammates are not paired against each other', () => {
    const rows = aggregateMatchupRecords([rec], null);
    const row = (a: string, b: string) => rows.find((r) => r.deckAId === a && r.deckBId === b)!;
    expect(row('d0', 'd2')).toMatchObject({ wins: 1, losses: 0 });
    expect(row('d1', 'd3')).toMatchObject({ wins: 1, losses: 0 });
    expect(row('d2', 'd1')).toBeUndefined();
    expect(row('d1', 'd2')).toMatchObject({ wins: 1, losses: 0 });
    expect(row('d0', 'd1')).toMatchObject({ wins: 0, losses: 0, played: 1 });
    expect(row('d2', 'd3')).toMatchObject({ wins: 0, losses: 0, played: 1 });
  });

  it('year in review: both winners and both losers are counted', () => {
    // Five identical games so every player clears the rate floor.
    const games = Array.from({ length: 5 }, (_, n) => ({
      id: `${rec.id}-${n}`,
      format: rec.format,
      endedAt: new Date('2026-05-05T12:00:00').getTime() + n,
      durationMs: 60_000,
      winnerSeat: rec.winnerSeat,
      seats: rec.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        deckId: p.deckId,
        deckName: p.deckName,
      })),
    }));
    const { playerRates } = buildYearRecap(games, 2026);
    const line = (name: string) => playerRates.find((p) => p.name === name);
    expect([line('P0')?.wins, line('P1')?.wins]).toEqual([5, 5]);
    expect([line('P2')?.losses, line('P3')?.losses]).toEqual([5, 5]);
    expect([line('P1')?.losses, line('P3')?.wins]).toEqual([0, 0]);
  });
});

describe('results outside Two-Headed Giant are unchanged', () => {
  const rec = finishedTable('commander', 3); // seat 0 is the last one standing

  it('credits only the single winner', () => {
    expect(rec.winnerSeat).toBe(0);
    expect(asDeck(rec, 0)).toMatchObject({ wins: 1, losses: 0 });
    expect(asDeck(rec, 1)).toMatchObject({ wins: 0, losses: 1 });
    expect(deckPilots([rec], 'd1', null)[0]).toMatchObject({ wins: 0, losses: 1 });
    expect(deckTableRead([rec], null, 'd1').wins).toBe(0);
  });
});
