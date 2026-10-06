// @vitest-environment node
//
// Reason truth (reasonCheck.ts): the false reasons the first optimizer gate
// found, restated, are caught; the true ones pass. Real cards throughout.
import { describe, expect, it } from 'vitest';
import { reasonProblem, type CheckedReason } from './reasonCheck';
import { BASELINE, MEREN, cards, merenCtx } from './__fixtures__/objectiveFixture';

const ctx = merenCtx();
const deckWith = (...names: string[]) => ({
  commanders: [MEREN],
  cards: [...BASELINE.cards.slice(0, 95), ...cards(...names)],
});
const problem = (
  r: Partial<CheckedReason> & Pick<CheckedReason, 'name' | 'term' | 'note'>,
  deck = deckWith(r.name)
) => reasonProblem({ value: 0.3, ...r }, deck, ctx);

describe('false reasons the gate found', () => {
  it('Elesh Norn is not a symmetric wipe on the face you cast', () => {
    expect(
      problem({
        name: 'Elesh Norn // The Argent Etchings',
        term: 'nonbo',
        note: "a symmetric wipe that hits 76.1% of the deck's own board",
      })
    ).toMatch(/face you cast/);
  });

  it('Wash Out spares the color its caster names', () => {
    expect(
      problem({
        name: 'Wash Out',
        term: 'nonbo',
        note: "a symmetric wipe that hits 100% of the deck's own board",
      })
    ).toMatch(/spares/);
  });

  it('Kaito Shizuki protects only himself', () => {
    expect(
      problem({ name: 'Kaito Shizuki', term: 'interaction', note: 'protection #2 (0.7)' })
    ).toMatch(/only protects itself/);
  });

  it('a feeder that is not in the deck, or makes nothing, feeds nothing', () => {
    expect(
      problem({
        name: 'Grave Pact',
        term: 'synergy',
        note: 'pays off death (payoff 1 of 3), fed by Mogg Fanatic, Viscera Seer',
      })
    ).toMatch(/Mogg Fanatic not in the deck/);
    expect(
      problem({
        name: 'Grave Pact',
        term: 'synergy',
        note: 'pays off death (payoff 1 of 3), fed by Sol Ring',
      })
    ).toMatch(/Sol Ring makes no death/);
  });

  it('a tutor finds only what its text lets it find', () => {
    expect(
      problem({
        name: 'Enlightened Tutor',
        term: 'tutors',
        note: 'tutor #1: finds Viscera Seer, a piece of Mikaeus, the Unhallowed + Viscera Seer (0.85)',
      })
    ).toMatch(/cannot find Viscera Seer/);
  });

  it("a page share must be the page's", () => {
    expect(
      problem({
        name: 'Viscera Seer',
        term: 'quality',
        note: "12% of this page's decks, 12% price-adjusted",
      })
    ).toMatch(/inclusion misread/);
  });
});

describe('true reasons pass', () => {
  it('reads a real answer, feeder and combo as true', () => {
    const deck = deckWith('Grave Pact', 'Path to Exile');
    expect(
      problem(
        {
          name: 'Grave Pact',
          term: 'synergy',
          note: 'pays off death (payoff 1 of 3), fed by Viscera Seer',
        },
        deck
      )
    ).toBeNull();
    expect(
      problem({
        name: 'Boseiju, Who Endures',
        term: 'interaction',
        note: 'answer #3: activated destroy artifact/enchantment/land (0.63)',
      })
    ).toBeNull();
    // "to its owner's hand": a bounce, as the text says it.
    expect(
      problem({
        name: 'Otawara, Soaring City',
        term: 'interaction',
        note: 'answer #4: activated bounce creature/artifact/enchantment/planeswalker (0.5)',
      })
    ).toBeNull();
    expect(
      problem({
        name: 'Viscera Seer',
        term: 'combos',
        note: 'piece of Mikaeus, the Unhallowed + Viscera Seer (1200 decks)',
      })
    ).toBeNull();
    expect(
      problem({
        name: 'Lightning Greaves',
        term: 'interaction',
        note: 'protection #1 (0.99): keeps the commander on the battlefield',
      })
    ).toBeNull();
  });
});

describe('names in a reason', () => {
  it('reads a list of names that hold commas and double faces', () => {
    const deck = { commanders: [MEREN], cards: BASELINE.cards };
    const lift = (list: string) =>
      reasonProblem(
        { name: 'Viscera Seer', term: 'lift', value: 0.1, note: `lifted by ${list}` },
        deck,
        ctx
      );
    expect(lift("Tergrid, God of Fright // Tergrid's Lantern, Blood Artist")).toBeNull();
    // A front face alone names the card; a first word alone does not.
    expect(lift('Tergrid, God of Fright, Blood Artist')).toBeNull();
    expect(lift('Tergrid, Mogg Fanatic')).toBe('Tergrid, Mogg Fanatic not in the deck');
  });
});
