import { describe, expect, it } from 'vitest';
import type { Deck } from '@/store/decks';
import {
  bracketSpread,
  combosLabel,
  deckFactsOf,
  gameChangersLabel,
  winTurnLabel,
  winTurnOf,
} from './pod-sheet';

describe('bracketSpread', () => {
  it('flags brackets more than one apart', () => {
    expect(bracketSpread([2, 4])).toEqual({ low: 2, high: 4 });
    expect(bracketSpread([1, 3, 3, 5])).toEqual({ low: 1, high: 5 });
  });
  it('does not flag adjacent or equal brackets', () => {
    expect(bracketSpread([3, 4])).toBeNull();
    expect(bracketSpread([3, 3, 3])).toBeNull();
  });
  it('ignores seats with no known bracket, and needs two known to compare', () => {
    expect(bracketSpread([2, null, undefined, 4])).toEqual({ low: 2, high: 4 });
    expect(bracketSpread([null, 5, undefined])).toBeNull();
    expect(bracketSpread([])).toBeNull();
  });
});

describe('deckFactsOf', () => {
  it('reads Game Changers and two-card combos off the last estimate', () => {
    const deck = {
      bracketEstimation: { breakdown: { gameChangerCount: 3, twoCardComboCount: 2 } },
    } as unknown as Deck;
    expect(deckFactsOf(deck)).toEqual({ gameChangers: 3, combos: 2, winTurn: null });
    expect(deckFactsOf(deck, 7)?.winTurn).toBe(7);
  });
  it('is null for a deck with no estimate, never zeros', () => {
    expect(deckFactsOf({} as Deck)).toBeNull();
  });
});

describe('winTurnOf', () => {
  it('is null for a deck with no win path to time', async () => {
    expect(await winTurnOf({ cards: [], winConditions: undefined })).toBeNull();
  });
});

describe('labels', () => {
  it('say counts the way a pod does', () => {
    expect(gameChangersLabel(1)).toBe('1 Game Changer');
    expect(gameChangersLabel(0)).toBe('0 Game Changers');
    expect(combosLabel(1)).toBe('1 combo');
    expect(combosLabel(2)).toBe('2 combos');
    expect(winTurnLabel(6)).toBe('Win path by turn 6');
  });
});
