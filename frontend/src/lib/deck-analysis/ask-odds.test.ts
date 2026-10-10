import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/tutors.fixture.json';
import {
  askOdds,
  cardsSeen,
  hypergeometricAtLeast,
  tutorFinds,
  tutorsFor,
  type OddsCard,
} from './ask-odds';

const cards = fixture.cards as OddsCard[];
const card = (name: string): OddsCard => {
  const c = cards.find((x) => x.name === name);
  if (!c) throw new Error(`fixture is missing ${name}`);
  return c;
};

describe('hypergeometricAtLeast', () => {
  it('matches a hand-worked case: one hit in 11 of 99', () => {
    expect(hypergeometricAtLeast(99, 1, 11, 1)).toBeCloseTo(11 / 99, 10);
  });
  it('matches the complement for three hits, any of which counts', () => {
    // 1 - (88/99)(87/98)(86/97) = 0.3004
    expect(hypergeometricAtLeast(99, 3, 11, 1)).toBeCloseTo(0.3004, 3);
  });
  it('handles at-least-two exactly', () => {
    // 4 hits, 2 draws from 10: P(both) = (4/10)(3/9)
    expect(hypergeometricAtLeast(10, 4, 2, 2)).toBeCloseTo(12 / 90, 10);
  });
  it('covers the edges', () => {
    expect(hypergeometricAtLeast(99, 5, 10, 0)).toBe(1);
    expect(hypergeometricAtLeast(99, 0, 10, 1)).toBe(0);
    expect(hypergeometricAtLeast(99, 3, 10, 4)).toBe(0);
    expect(hypergeometricAtLeast(10, 10, 10, 10)).toBeCloseTo(1, 10);
    expect(hypergeometricAtLeast(10, 9, 20, 9)).toBeCloseTo(1, 10);
  });
});

describe('askOdds', () => {
  it('counts draws: none on turn 1 on the play, one on the draw', () => {
    expect(cardsSeen(1, true)).toBe(7);
    expect(cardsSeen(1, false)).toBe(8);
    expect(cardsSeen(5, true)).toBe(11);
    expect(cardsSeen(5, false)).toBe(12);
  });
  it('gives 11% and 12% for a single card by turn 5 in 99 cards', () => {
    const o = askOdds(99, 1, 1, 5);
    expect(Math.round(o.play * 100)).toBe(11);
    expect(Math.round(o.draw * 100)).toBe(12);
  });
});

describe('tutorFinds (real oracle text)', () => {
  const livingDeath = card('Living Death');
  it('finds a sorcery with Demonic Tutor and Vampiric Tutor', () => {
    expect(tutorFinds(card('Demonic Tutor'), livingDeath)).toBe(true);
    expect(tutorFinds(card('Vampiric Tutor'), livingDeath)).toBe(true);
    expect(tutorFinds(card('Imperial Seal'), livingDeath)).toBe(true);
  });
  it('does not count creature-only tutors for a sorcery', () => {
    expect(tutorFinds(card('Worldly Tutor'), livingDeath)).toBe(false);
    expect(tutorFinds(card('Survival of the Fittest'), livingDeath)).toBe(false);
  });
  it('reads type lists and subtypes', () => {
    expect(tutorFinds(card('Mystical Tutor'), livingDeath)).toBe(true);
    expect(tutorFinds(card('Enlightened Tutor'), livingDeath)).toBe(false);
    expect(tutorFinds(card('Enlightened Tutor'), card('Sol Ring'))).toBe(true);
    expect(tutorFinds(card('Worldly Tutor'), card('Stoneforge Mystic'))).toBe(true);
    expect(tutorFinds(card('Sliver Overlord'), card('Sliver Overlord'))).toBe(false);
  });
  it('skips searches that put the card onto the battlefield, and non-tutors', () => {
    expect(tutorFinds(card('Chord of Calling'), card('Stoneforge Mystic'))).toBe(false);
    expect(tutorFinds(card('Cultivate'), livingDeath)).toBe(false);
    expect(tutorFinds(card('Sol Ring'), livingDeath)).toBe(false);
  });
  it('never counts a card as its own tutor', () => {
    expect(tutorFinds(card('Demonic Tutor'), card('Demonic Tutor'))).toBe(false);
  });
});

describe('tutorsFor', () => {
  it('names the tutors that reach Living Death, once each', () => {
    const deck = [
      card('Demonic Tutor'),
      card('Vampiric Tutor'),
      card('Vampiric Tutor'),
      card('Worldly Tutor'),
      card('Survival of the Fittest'),
      card('Sol Ring'),
    ];
    expect(tutorsFor(deck, card('Living Death')).map((c) => c.name)).toEqual([
      'Demonic Tutor',
      'Vampiric Tutor',
    ]);
  });
});
