// @vitest-environment node
// E513: the search's per-card notes, as the build report states them. The
// inputs are notes the generator really wrote on the standard and collection
// panels (2026-10, the flag-on blind gate); the outputs may name no rank,
// score or objective term.
import { describe, expect, it } from 'vitest';
import { plainDisclosure, plainNote } from './swapCopy';

const JARGON = /#\d|\(\d+\.\d+\)|price-adjusted|doubling|\bscrew\b|on curve|payoff \d of|\bq\b/;

const REAL: Array<[string, string]> = [
  [
    "46.4% of this page's decks, 43.2% price-adjusted (1.02 USD)",
    "in 46% of this commander's decks (1.02 USD)",
  ],
  ['answer #4: instant exile creature (0.7)', 'an answer: instant exile creature'],
  ['castable on curve 74.4% (turn 5)', 'cast on turn 5 in 74% of games'],
  [
    'protection #1 (1.5): keeps the commander on the battlefield',
    'keeps the commander on the battlefield',
  ],
  [
    'draw engine #1: draws on every trigger (0.92)',
    'a card-draw engine that draws on every trigger',
  ],
  ['buy for 25.64 USD: 3.79 price doublings', 'you would have to buy it, 25.64 USD'],
  [
    "lifted by Tekuthal, Inquiry Dominus, Vraska, Betrayal's Sting",
    "played more often alongside Tekuthal, Inquiry Dominus, Vraska, Betrayal's Sting",
  ],
  [
    'pays off poison (payoff 1 of 5), fed by Prologue to Phyresis, Vishgraz, the Doomhive and 8 more',
    "pays off the deck's poison cards, fed by Prologue to Phyresis, Vishgraz, the Doomhive and 8 more",
  ],
  [
    'piece of Godo, Bandit Warlord + Helm of the Host (25714 decks: Infinite combat phases)',
    'part of the Godo, Bandit Warlord + Helm of the Host combo, in 25714 decks (Infinite combat phases)',
  ],
  [
    'tutor #2: finds Helm of the Host, a piece of Godo, Bandit Warlord + Helm of the Host (0.49)',
    'a tutor that finds Helm of the Host, a piece of Godo, Bandit Warlord + Helm of the Host',
  ],
  ['roles: draw 12 → 11 of target 9', 'card counts: draw 12 → 11 (aiming for 9)'],
  [
    'land base: screw 12.4% by turn 3, flood 20% at turn 6',
    'the lands: 12% of games miss a land drop by turn 3, 20% flood by turn 6',
  ],
];

describe('plainNote', () => {
  it.each(REAL)('%s', (note, plain) => {
    expect(plainNote(note)).toBe(plain);
    expect(plainNote(note)).not.toMatch(JARGON);
  });

  it('passes a shape it does not know through untouched', () => {
    expect(plainNote('a rock that adds one mana')).toBe('a rock that adds one mana');
  });
});

describe('plainDisclosure', () => {
  it("drops the objective's own term for the floor", () => {
    expect(plainDisclosure('no owned card keeps the class floor (it is a land)')).toBe(
      'no card you own keeps enough of that kind of card (it is a land)'
    );
  });
});
