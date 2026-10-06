// @vitest-environment node
// E513: a swap's body in plain words. The notes below are shapes the generator
// really wrote on the standard and collection panels (2026-10, the flag-on gate);
// the report titles each swap "Out → In" already, so the body never repeats it.
import { describe, expect, it } from 'vitest';
import type { SwapReason } from '../deckObjective/swapReasons';
import { nameList, plainDisclosure, swapSentences } from './swapCopy';

const JARGON = /#\d|\(\d+\.\d+\)|price-adjusted|doubling|\bscrew\b|on curve|payoff \d of|→ \d+ of/;
const r = (name: string, term: SwapReason['term'], value: number, note: string, names?: string[]) =>
  ({ name, term, value, note, ...(names ? { names } : {}) }) as SwapReason;

const FEEDERS = [
  'Prologue to Phyresis',
  'Infectious Inquiry',
  "Vraska's Fall",
  'Skrelv, Defector Mite',
  'Vishgraz, the Doomhive',
  'Tezzeret',
  'Ezuri',
  'Tekuthal',
];

const phyresis = {
  in: ['Phyresis Outbreak'],
  out: ["White Sun's Twilight"],
  kind: 'improve',
  reasons: [
    r(
      'Phyresis Outbreak',
      'synergy',
      0.9,
      "pays off poison (payoff 1 of 5), fed by Prologue to Phyresis, Infectious Inquiry, Vraska's Fall, Skrelv, Defector Mite and 4 more",
      FEEDERS
    ),
    r(
      'Phyresis Outbreak',
      'quality',
      0.5,
      "29.9% of this page's decks, 39.6% price-adjusted (12.97 USD)"
    ),
    r('Phyresis Outbreak', 'lift', 0.3, 'lifted by Tekuthal, Inquiry Dominus, Ezuri'),
    r(
      "White Sun's Twilight",
      'quality',
      -0.4,
      "11.2% of this page's decks, 12% price-adjusted (1.02 USD)"
    ),
  ],
};

describe('swapSentences', () => {
  it('states why the card came in: its two strongest reasons, three names at most', () => {
    const { why } = swapSentences(phyresis);
    expect(why).toBe(
      "Pays off the deck's poison theme (fed by Prologue to Phyresis, Infectious Inquiry, Vraska's Fall and 5 more) and is in 30% of this commander's decks."
    );
  });

  it('does not repeat the heading or run on', () => {
    const { why, weaker } = swapSentences(phyresis);
    const body = [why, weaker].join(' ');
    expect(body).not.toContain('Phyresis Outbreak for');
    expect(body).not.toContain(';');
    expect(body).not.toMatch(JARGON);
  });

  it('says why the card that left was weaker: a lower play rate than the newcomer', () => {
    expect(swapSentences(phyresis).weaker).toBe(
      "White Sun's Twilight was in only 11% of this commander's decks."
    );
  });

  it('says what a card that left had cost the deck', () => {
    const { weaker } = swapSentences({
      in: ['Wrenn and Realmbreaker'],
      out: ['Delighted Halfling'],
      kind: 'improve',
      reasons: [
        r('Wrenn and Realmbreaker', 'engines', 0.8, 'draw engine #1: draws every turn (0.82)'),
        r('Delighted Halfling', 'ownership', 0.3, 'buy for 25.64 USD: 3.79 price doublings'),
      ],
    });
    expect(weaker).toBe('Delighted Halfling would have cost 25.64 USD to buy.');
  });

  it('never praises the card that left: merits alone give no second sentence', () => {
    const { why, weaker } = swapSentences({
      in: ['Infectious Bite'],
      out: ['Esper Sentinel'],
      kind: 'improve',
      reasons: [
        r('Esper Sentinel', 'engines', -0.5, 'draw engine #1: draws on every trigger (0.92)'),
        r('Infectious Bite', 'mana', 0.2, 'castable on curve 92% (turn 2)'),
      ],
    });
    expect(why).toBe('Is usually castable by turn 2.');
    expect(weaker).toBeNull();
  });

  it('names the role counts a swap moved, in plain words', () => {
    const { why } = swapSentences({
      in: ['Aggravated Assault'],
      out: ['Drakuseth, Maw of Flames'],
      kind: 'improve',
      reasons: [r('Aggravated Assault', 'roles', 0.4, 'roles: removal 8 → 6 of target 5')],
    });
    expect(why).toBe("Moves the deck's removal from 8 to 6 (aiming for 5).");
  });

  it('owns up to a swap a build rule forced, still saying what the new card does', () => {
    const { why } = swapSentences({
      in: ['Defend the Rider'],
      out: ['Swiftfoot Boots'],
      kind: 'repair',
      reasons: [
        r(
          'Defend the Rider',
          'interaction',
          1.5,
          'protection #1 (1.5): keeps the commander on the battlefield'
        ),
      ],
    });
    expect(why).toBe(
      'A build rule you set needed this swap, and Defend the Rider keeps the commander on the battlefield.'
    );
  });

  it('names each card of a two-for-two on its own clause', () => {
    const { why } = swapSentences({
      in: ['Aggravated Assault', 'Mardu Siegebreaker'],
      out: ['Drakuseth, Maw of Flames', 'Will of the Mardu'],
      kind: 'combo',
      reasons: [
        r('Aggravated Assault', 'mana', 0.5, 'castable on curve 91.9% (turn 3)'),
        r(
          'Mardu Siegebreaker',
          'quality',
          0.4,
          "20% of this page's decks, 20% price-adjusted (1.00 USD)"
        ),
      ],
    });
    expect(why).toBe(
      "Aggravated Assault is usually castable by turn 3 and Mardu Siegebreaker is in 20% of this commander's decks."
    );
  });
});

describe('smaller shapes', () => {
  it('says a free card costs nothing, and states an answer by its speed', () => {
    const one = (term: SwapReason['term'], note: string) =>
      swapSentences({
        in: ['X'],
        out: ['Y'],
        kind: 'improve',
        reasons: [r('X', term, 1, note)],
      }).why;
    expect(one('mana', 'castable on curve 90% (turn 0)')).toBe('Costs nothing to cast.');
    expect(one('interaction', 'answer #2: instant counter spell (0.74)')).toBe(
      'Adds an instant-speed answer.'
    );
  });

  it('names each card that left a two-for-two, each with its own weakness', () => {
    const { weaker } = swapSentences({
      in: ['A', 'B'],
      out: ['C', 'D'],
      kind: 'combo',
      reasons: [
        r('A', 'quality', 1, "40% of this page's decks, 40% price-adjusted (1.00 USD)"),
        r('C', 'quality', -1, "10% of this page's decks, 10% price-adjusted (1.00 USD)"),
        r('D', 'quality', -1, "12% of this page's decks, 12% price-adjusted (1.00 USD)"),
      ],
    });
    expect(weaker).toBe(
      "C was in only 10% of this commander's decks, and D was in only 12% of this commander's decks."
    );
  });
});

describe('nameList', () => {
  it('keeps three names and counts the rest', () => {
    expect(nameList(['A', 'B'])).toBe('A and B');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('separates names that hold a comma with semicolons', () => {
    expect(nameList(['Tekuthal, Inquiry Dominus', 'Ezuri, Stalker of Spheres', 'Vraska'])).toBe(
      'Tekuthal, Inquiry Dominus; Ezuri, Stalker of Spheres and Vraska'
    );
  });
});

describe('plainDisclosure', () => {
  it("drops the objective's own term for the floor", () => {
    expect(plainDisclosure('no owned card keeps the class floor (it is a land)')).toBe(
      'no card you own keeps enough of that kind of card (it is a land)'
    );
  });
});
