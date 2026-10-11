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

describe('tutorFinds reads a tutor restriction (real oracle text)', () => {
  const reaches = (tutor: string, target: string) => tutorFinds(card(tutor), card(target));
  it('Trinket Mage fetches artifacts with mana value 1 or less only', () => {
    expect(reaches('Trinket Mage', 'Sol Ring')).toBe(true);
    expect(reaches('Trinket Mage', 'Skullclamp')).toBe(true);
    expect(reaches('Trinket Mage', 'Ornithopter')).toBe(true);
    expect(reaches('Trinket Mage', 'Mind Stone')).toBe(false);
    expect(reaches('Trinket Mage', 'Sword of Fire and Ice')).toBe(false);
    expect(reaches('Trinket Mage', 'Llanowar Elves')).toBe(false);
  });
  it('Ranger-Captain of Eos fetches creatures with mana value 1 or less only', () => {
    expect(reaches('Ranger-Captain of Eos', 'Llanowar Elves')).toBe(true);
    expect(reaches('Ranger-Captain of Eos', 'Mother of Runes')).toBe(true);
    expect(reaches('Ranger-Captain of Eos', 'Kitchen Finks')).toBe(false);
    expect(reaches('Ranger-Captain of Eos', 'Eternal Witness')).toBe(false);
    expect(reaches('Ranger-Captain of Eos', 'Skullclamp')).toBe(false);
  });
  it('Imperial Recruiter reads power, Recruiter of the Guard reads toughness', () => {
    expect(reaches('Imperial Recruiter', 'Goblin Guide')).toBe(true);
    expect(reaches('Imperial Recruiter', 'Squire')).toBe(true);
    expect(reaches('Imperial Recruiter', 'Kitchen Finks')).toBe(false);
    expect(reaches('Recruiter of the Guard', 'Squire')).toBe(true);
    expect(reaches('Recruiter of the Guard', 'Kitchen Finks')).toBe(true);
    expect(reaches('Recruiter of the Guard', 'Wall of Roots')).toBe(false);
    expect(reaches('Recruiter of the Guard', 'Sol Ring')).toBe(false);
  });
  it('reads a subtype or type word: Goblin Matron, Steelshaper, Fabricate, Idyllic', () => {
    expect(reaches('Goblin Matron', 'Goblin Guide')).toBe(true);
    expect(reaches('Goblin Matron', 'Goblin Chieftain')).toBe(true);
    expect(reaches('Goblin Matron', 'Kitchen Finks')).toBe(false);
    expect(reaches("Steelshaper's Gift", 'Skullclamp')).toBe(true);
    expect(reaches("Steelshaper's Gift", 'Sol Ring')).toBe(false);
    expect(reaches('Stoneforge Mystic', 'Sword of Fire and Ice')).toBe(true);
    expect(reaches('Stoneforge Mystic', 'Sol Ring')).toBe(false);
    expect(reaches('Fabricate', 'Mind Stone')).toBe(true);
    expect(reaches('Fabricate', 'Burnished Hart')).toBe(true);
    expect(reaches('Idyllic Tutor', 'Rancor')).toBe(true);
    expect(reaches('Idyllic Tutor', 'Sol Ring')).toBe(false);
  });
  it('transmute reaches exactly its own mana value', () => {
    expect(reaches('Dimir Infiltrator', 'Mind Stone')).toBe(true);
    expect(reaches('Dimir Infiltrator', 'Squire')).toBe(true);
    expect(reaches('Dimir Infiltrator', 'Sol Ring')).toBe(false);
    expect(reaches('Dimir Infiltrator', 'Kitchen Finks')).toBe(false);
    expect(reaches('Tolaria West', 'Ornithopter')).toBe(true);
    expect(reaches('Tolaria West', 'Sol Ring')).toBe(false);
  });
  it('leaves unrestricted tutors and battlefield searches as they were', () => {
    expect(reaches('Diabolic Intent', 'Kitchen Finks')).toBe(true);
    // the opponent chooses what Gifts Ungiven puts in hand, so it is no reliable tutor
    expect(reaches('Gifts Ungiven', 'Sol Ring')).toBe(false);
    expect(reaches("Green Sun's Zenith", 'Llanowar Elves')).toBe(false);
  });
  it('tutorsFor lists only the restricted tutors that reach Mind Stone', () => {
    const deck = ['Trinket Mage', 'Fabricate', 'Dimir Infiltrator', 'Ranger-Captain of Eos'].map(
      card
    );
    expect(tutorsFor(deck, card('Mind Stone')).map((c) => c.name)).toEqual([
      'Fabricate',
      'Dimir Infiltrator',
    ]);
  });
});
