import { describe, it, expect } from 'vitest';
import type { GameSummary } from '@spellcontrol/game-core';
import { applyResultEdit } from './edit-result';
import { parseResultEdit } from './local-result';
import type { GameResultParticipant } from './result-types';

function seat(over: Partial<GameResultParticipant> & { seat: number }): GameResultParticipant {
  return {
    userId: null,
    username: null,
    name: `P${over.seat}`,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
    finalLife: 40,
    eliminated: false,
    ...over,
  };
}

function summary(placements: Array<[number, number | null]>): GameSummary {
  return {
    turns: 4,
    durationMs: 1000,
    firstBlood: null,
    startingSeat: 0,
    winnerSeat: placements.find(([, p]) => p === 1)?.[0] ?? null,
    seats: placements.map(([s, placement]) => ({
      seat: s,
      damageTaken: 0,
      lifeGained: 0,
      biggestHit: 0,
      lowestLife: 40,
      commanderDamageDealt: 0,
      placement,
      eliminatedOnTurn: null,
      killedBySeat: null,
    })),
    commanderDamage: [],
  };
}

describe('applyResultEdit', () => {
  it('moves the winner, the credited account and the first place together', () => {
    const before = [seat({ seat: 0, userId: 'u0' }), seat({ seat: 1, userId: 'u1' })];
    const out = applyResultEdit(before, summary([[0, 1]]), {
      winnerSeat: 1,
      decks: new Map(),
    });
    expect(out.winnerSeat).toBe(1);
    expect(out.winnerUserId).toBe('u1');
    expect(out.summary?.winnerSeat).toBe(1);
  });

  it('leaves an eliminated seat its earned placement when the winner changes', () => {
    // Seat 2 died third-of-three; that is a fact of the log, not of who won,
    // so re-crowning seat 1 must not disturb it.
    const before = [seat({ seat: 0 }), seat({ seat: 1 }), seat({ seat: 2, eliminated: true })];
    const out = applyResultEdit(
      before,
      summary([
        [0, 1],
        [1, null],
        [2, 3],
      ]),
      { winnerSeat: 1, decks: new Map() }
    );
    const bySeat = new Map(out.summary!.seats.map((s) => [s.seat, s.placement]));
    expect(bySeat.get(0)).toBe(null);
    expect(bySeat.get(1)).toBe(1);
    expect(bySeat.get(2)).toBe(3);
  });

  it('writes deck attribution only for the seats it was given', () => {
    const before = [seat({ seat: 0, deckName: 'Old' }), seat({ seat: 1, deckName: 'Keep me' })];
    const out = applyResultEdit(before, null, {
      winnerSeat: 0,
      decks: new Map([
        [0, { deckId: 'd', deckName: 'New', commander: 'Kenrith', colorIdentity: ['W'] }],
      ]),
    });
    expect(out.participants[0].deckName).toBe('New');
    expect(out.participants[0].commander).toBe('Kenrith');
    expect(out.participants[1].deckName).toBe('Keep me');
    // A pre-migration row carries no summary, and an edit must not invent one.
    expect(out.summary).toBe(null);
  });

  it('never keeps a stale first place when the winner is cleared', () => {
    const out = applyResultEdit([seat({ seat: 0 }), seat({ seat: 1 })], summary([[0, 1]]), {
      winnerSeat: null,
      decks: new Map(),
    });
    expect(out.winnerSeat).toBe(null);
    expect(out.winnerUserId).toBe(null);
    expect(out.summary?.seats[0].placement).toBe(null);
  });
});

describe('parseResultEdit', () => {
  it('reads a winner and normalizes deck attribution', () => {
    const parsed = parseResultEdit({
      winnerSeat: 2,
      decks: [
        { seat: 2, deckId: 'd1', deckName: 'X', commander: 'Y', colorIdentity: ['g', 'g', 'z'] },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.edit.winnerSeat).toBe(2);
    expect(parsed.edit.decks.get(2)).toEqual({
      deckId: 'd1',
      deckName: 'X',
      commander: 'Y',
      colorIdentity: ['G'],
    });
  });

  it('treats a missing winner as no winner, and an empty deck list as no change', () => {
    const parsed = parseResultEdit({});
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.edit.winnerSeat).toBe(null);
    expect(parsed.edit.decks.size).toBe(0);
  });

  it('rejects a bad body, an out-of-range seat and a repeated seat', () => {
    expect(parseResultEdit(null).ok).toBe(false);
    expect(parseResultEdit({ winnerSeat: 99 }).ok).toBe(false);
    expect(parseResultEdit({ winnerSeat: 1.5 }).ok).toBe(false);
    expect(parseResultEdit({ decks: 'nope' }).ok).toBe(false);
    expect(parseResultEdit({ decks: [{ seat: 0 }, { seat: 0 }] }).ok).toBe(false);
  });
});
