import { describe, expect, it } from 'vitest';
import type { PodRule0Deck } from './pods-client';
import { gapLine, signalPhrases, spreadLine, widestGap } from './rule0-notes';

function deck(over: Partial<PodRule0Deck> = {}): PodRule0Deck {
  return {
    userId: 'u1',
    username: 'ana',
    deckId: 'd1',
    name: 'Atraxa',
    commanderName: 'Atraxa',
    bracket: 3,
    bracketStated: false,
    estimatedBracket: 3,
    estimateIsFloor: false,
    signals: {
      gameChangers: 0,
      gameChangerNames: [],
      massLandDenial: 0,
      extraTurns: 0,
      twoCardCombos: 0,
      multiCardCombos: 0,
    },
    reach: 'public',
    mine: false,
    ...over,
  };
}
const withSignals = (o: Partial<NonNullable<PodRule0Deck['signals']>>) => ({
  ...deck().signals!,
  ...o,
});

describe('spreadLine', () => {
  it('is null with no decks', () => {
    expect(spreadLine([])).toBeNull();
  });
  it('reads a range and counts the decks that carry a signal', () => {
    const line = spreadLine([
      deck({ bracket: 2 }),
      deck({ userId: 'u2', deckId: 'd2', bracket: 4, signals: withSignals({ twoCardCombos: 1 }) }),
      deck({ userId: 'u3', deckId: 'd3', bracket: 3 }),
    ]);
    expect(line).toBe('Brackets 2 to 4; one deck has a two-card combo.');
  });
  it('says so when every deck sits in one bracket', () => {
    expect(spreadLine([deck(), deck({ deckId: 'd2' })])).toBe('All Bracket 3.');
  });
  it('pluralizes and mentions unrated decks', () => {
    const s = withSignals({ extraTurns: 2, massLandDenial: 1 });
    const line = spreadLine([
      deck({ signals: s }),
      deck({ deckId: 'd2', signals: s }),
      deck({ deckId: 'd3', bracket: null, estimatedBracket: null, signals: null }),
    ]);
    expect(line).toBe(
      'All Bracket 3; two decks have mass land denial; two decks run extra turns; one deck not rated yet.'
    );
  });
  it('still speaks when nothing is rated', () => {
    expect(spreadLine([deck({ bracket: null, signals: null })])).toBe('one deck not rated yet.');
  });
});

describe('widestGap', () => {
  it('needs two brackets between different owners', () => {
    const a = deck({ bracket: 2 });
    const b = deck({ userId: 'u2', deckId: 'd2', username: 'bo', name: 'Korvold', bracket: 4 });
    const gap = widestGap([a, b])!;
    expect(gap.low).toBe(a);
    expect(gap.high).toBe(b);
    expect(gapLine(gap)).toBe(
      'Widest gap: Atraxa (ana) at Bracket 2 and Korvold (bo) at Bracket 4.'
    );
  });
  it('ignores a one-bracket difference and a gap inside one shelf', () => {
    expect(widestGap([deck({ bracket: 2 }), deck({ userId: 'u2', bracket: 3 })])).toBeNull();
    expect(widestGap([deck({ bracket: 1 }), deck({ deckId: 'd2', bracket: 4 })])).toBeNull();
  });
});

describe('signalPhrases', () => {
  it('lists only what is present', () => {
    expect(signalPhrases(withSignals({}))).toEqual([]);
    expect(
      signalPhrases(withSignals({ gameChangers: 1, extraTurns: 3, massLandDenial: 1 }))
    ).toEqual(['1 Game Changer', 'mass land denial', '3 extra-turn cards']);
  });
});
