import { describe, it, expect } from 'vitest';
import {
  buildSnapshot,
  cardCounts,
  diffSnapshots,
  hasChanges,
  sameCards,
  sinceSummary,
  type DeckSnapshot,
} from './deck-since';
import type { Deck } from '@/store/decks';
import { makeDeck } from './deck-since.fixtures';

const ATRAXA = 'Atraxa, Praetors’ Voice';

const ROLES: Record<string, string[]> = {
  'Sol Ring': ['ramp'],
  Cultivate: ['ramp'],
  'Swords to Plowshares': ['removal'],
  'Rhystic Study': ['cardDraw'],
};
const rolesOf = (n: string) => ROLES[n] ?? [];

describe('cardCounts / buildSnapshot', () => {
  it('counts copies by name, commander included, and lands from type lines', () => {
    const deck = makeDeck(['Forest', 'Forest', 'Command Tower', 'Sol Ring'], ATRAXA);
    expect(cardCounts(deck)).toEqual({
      [ATRAXA]: 1,
      Forest: 2,
      'Command Tower': 1,
      'Sol Ring': 1,
    });
    const snap = buildSnapshot(deck, false, {}, 5);
    expect(snap.at).toBe(5);
    expect(snap.metrics.lands).toBe(3);
  });

  it('leaves role counts out until the tagger is ready, rather than reading zero', () => {
    const snap = buildSnapshot(makeDeck(['Sol Ring']), false);
    expect(snap.metrics.ramp).toBeUndefined();
    expect(snap.metrics.removal).toBeUndefined();
  });

  it('carries the async numbers and the bracket signals when present', () => {
    const deck = makeDeck(['Rhystic Study'], ATRAXA, {
      bracketEstimation: {
        bracket: 3,
        label: 'Upgraded',
        hardFloors: [],
        softScore: 4,
        breakdown: {
          gameChangerCount: 1,
          extraTurnCount: 0,
          massLandDenialCount: 0,
          twoCardComboCount: 0,
          fastManaCount: 2,
          tutorCount: 1,
        },
      } as unknown as Deck['bracketEstimation'],
    });
    const m = buildSnapshot(deck, false, { castable: 0.91, clockTurn: 7 }).metrics;
    expect(m).toMatchObject({
      bracket: 3,
      gameChangers: 1,
      fastMana: 2,
      tutors: 1,
      castable: 0.91,
      clockTurn: 7,
    });
  });
});

const snap = (cards: Record<string, number>, metrics: DeckSnapshot['metrics']): DeckSnapshot => ({
  at: 0,
  cards,
  metrics,
});

describe('diffSnapshots', () => {
  it('names the metric rows and the cards behind them', () => {
    const base = snap({ 'Sol Ring': 1, Forest: 1 }, { lands: 1, ramp: 1, removal: 0 });
    const now = snap(
      { 'Sol Ring': 1, Forest: 2, Cultivate: 1, 'Swords to Plowshares': 1 },
      { lands: 2, ramp: 2, removal: 1 }
    );
    const d = diffSnapshots(base, now, rolesOf);
    expect(d.rows.map((r) => `${r.label} ${r.fromText} to ${r.toText}`)).toEqual([
      'Lands 1 to 2',
      'Ramp 1 to 2',
      'Removal 0 to 1',
    ]);
    expect(d.added).toEqual([
      { name: 'Cultivate', qty: 1, roles: ['ramp'] },
      { name: 'Forest', qty: 1, roles: [] },
      { name: 'Swords to Plowshares', qty: 1, roles: ['removal'] },
    ]);
    expect(d.removed).toEqual([]);
    expect(sinceSummary(d)).toBe('Lands 1 to 2, Ramp 1 to 2, Removal 0 to 1');
  });

  it('reports removed cards and a falling number', () => {
    const base = snap({ 'Rhystic Study': 1, 'Sol Ring': 1 }, { cardDraw: 1, bracket: 3 });
    const now = snap({ 'Sol Ring': 1 }, { cardDraw: 0, bracket: 2 });
    const d = diffSnapshots(base, now, rolesOf);
    expect(d.removed).toEqual([{ name: 'Rhystic Study', qty: 1, roles: ['cardDraw'] }]);
    expect(d.rows.map((r) => [r.label, r.direction])).toEqual([
      ['Bracket', 'down'],
      ['Card draw', 'down'],
    ]);
  });

  it('shows a row only when both sides measured it', () => {
    const base = snap({ Forest: 1 }, { lands: 1 });
    const now = snap({ Forest: 2 }, { lands: 2, castable: 0.8, clockTurn: 6, bracket: 3 });
    expect(diffSnapshots(base, now).rows.map((r) => r.key)).toEqual(['lands']);
  });

  it('treats castability under two points as simulation noise', () => {
    const base = snap({ Forest: 1 }, { castable: 0.9 });
    expect(diffSnapshots(base, snap({ Forest: 1 }, { castable: 0.91 })).rows).toEqual([]);
    const moved = diffSnapshots(base, snap({ Forest: 1 }, { castable: 0.85 }));
    expect(moved.rows[0]).toMatchObject({
      label: 'Castable on curve',
      fromText: '90%',
      toText: '85%',
    });
  });

  it('formats the clock as a turn and the bracket as B#', () => {
    const d = diffSnapshots(
      snap({}, { clockTurn: 9, bracket: 2 }),
      snap({}, { clockTurn: 7, bracket: 3 })
    );
    expect(d.rows.map((r) => `${r.label}: ${r.fromText} to ${r.toText}`)).toEqual([
      'Bracket: B2 to B3',
      'Win path online: turn 9 to turn 7',
    ]);
  });

  it('is empty, and hasChanges false, when nothing moved', () => {
    const s = snap({ Forest: 1 }, { lands: 1 });
    expect(hasChanges(diffSnapshots(s, s))).toBe(false);
  });

  it('counts a changed copy count, and falls back to a card tally with no rows', () => {
    const d = diffSnapshots(snap({ Forest: 1 }, {}), snap({ Forest: 4 }, {}));
    expect(d.added).toEqual([{ name: 'Forest', qty: 3, roles: [] }]);
    expect(sinceSummary(d)).toBe('3 cards changed');
    expect(sinceSummary(diffSnapshots(snap({ Forest: 1 }, {}), snap({ Forest: 2 }, {})))).toBe(
      '1 card changed'
    );
  });

  it('caps the summary and says how many rows it left out', () => {
    const base = snap({}, { lands: 1, ramp: 1, cardDraw: 1, removal: 1 });
    const now = snap({}, { lands: 2, ramp: 2, cardDraw: 2, removal: 2 });
    expect(sinceSummary(diffSnapshots(base, now))).toBe(
      'Lands 1 to 2, Ramp 1 to 2, Card draw 1 to 2, 1 more'
    );
  });
});

describe('sameCards', () => {
  it('compares names and counts', () => {
    expect(sameCards(snap({ a: 1 }, {}), snap({ a: 1 }, {}))).toBe(true);
    expect(sameCards(snap({ a: 1 }, {}), snap({ a: 2 }, {}))).toBe(false);
    expect(sameCards(snap({ a: 1 }, {}), snap({ a: 1, b: 1 }, {}))).toBe(false);
  });
});
