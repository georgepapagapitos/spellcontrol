import { describe, it, expect } from 'vitest';
import { cardTypes, mainType, scoreGuess, isSolved, type CardAttrs } from './score';

const swords: CardAttrs = {
  name: 'Swords to Plowshares',
  colors: 'W',
  mv: 1,
  typeLine: 'Instant',
  rarity: 'uncommon',
  year: 1993,
};

function card(over: Partial<CardAttrs>): CardAttrs {
  return { ...swords, name: 'Guess', ...over };
}

describe('cardTypes / mainType', () => {
  it('reads the front face, left of the dash, in precedence order', () => {
    expect(cardTypes('Legendary Artifact Creature — Golem')).toEqual(['Creature', 'Artifact']);
    expect(mainType('Legendary Artifact Creature — Golem')).toBe('Creature');
    expect(mainType('Instant // Instant')).toBe('Instant');
    expect(mainType('Creature — Human Wizard // Creature — Human Insect')).toBe('Creature');
    expect(cardTypes('Tribal Instant — Faerie')).toEqual(['Instant', 'Kindred']);
  });

  it('falls back to the raw left side when no card type is recognised', () => {
    expect(mainType('Conspiracy')).toBe('Conspiracy');
  });
});

describe('scoreGuess', () => {
  it('marks every cell a hit for the answer itself', () => {
    expect(scoreGuess(swords, swords)).toEqual({
      colors: 'hit',
      mv: 'hit',
      type: 'hit',
      rarity: 'hit',
      year: 'hit',
    });
    expect(isSolved(swords, swords)).toBe(true);
  });

  it('scores Lightning Bolt against Swords: wrong colour, rarity one step off', () => {
    const bolt = card({ name: 'Lightning Bolt', colors: 'R', rarity: 'common' });
    expect(scoreGuess(bolt, swords)).toEqual({
      colors: 'miss',
      mv: 'hit',
      type: 'hit',
      rarity: 'near',
      year: 'hit',
    });
    expect(isSolved(bolt, swords)).toBe(false);
  });

  it('points mana value and year toward the answer, never "near"', () => {
    const path = card({ mv: 3, year: 2009 });
    const s = scoreGuess(path, swords);
    expect(s.mv).toBe('lower');
    expect(s.year).toBe('lower');
    expect(scoreGuess(card({ mv: 0, year: 1990 }), swords)).toMatchObject({
      mv: 'higher',
      year: 'higher',
    });
  });

  it('calls colours near on a partial overlap and a hit only on the exact set', () => {
    expect(scoreGuess(card({ colors: 'WU' }), swords).colors).toBe('near');
    expect(scoreGuess(card({ colors: '' }), card({ colors: '' })).colors).toBe('hit');
    expect(scoreGuess(card({ colors: '' }), swords).colors).toBe('miss');
  });

  it('calls type near when a card type is shared but the main type differs', () => {
    const answer = card({ typeLine: 'Artifact Creature — Golem' });
    expect(scoreGuess(card({ typeLine: 'Artifact' }), answer).type).toBe('near');
    expect(scoreGuess(card({ typeLine: 'Legendary Creature — Elf' }), answer).type).toBe('hit');
    expect(scoreGuess(card({ typeLine: 'Sorcery' }), answer).type).toBe('miss');
  });

  it('calls rarity a miss two or more steps away', () => {
    expect(scoreGuess(card({ rarity: 'mythic' }), swords).rarity).toBe('miss');
    expect(scoreGuess(card({ rarity: 'special' }), card({ rarity: 'mythic' })).rarity).toBe('near');
  });
});
