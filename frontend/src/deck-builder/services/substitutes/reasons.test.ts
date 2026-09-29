import { describe, expect, it } from 'vitest';
import { extractCardFacts } from '../cardFacts/extract';
import { deckFit, deckProfile, MIN_SUPPORT } from './deckContext';
import { DECK_FIT_WEIGHT, scoreSubstitute } from './ranker';
import { substituteFactors, tupleWords } from './reasons';
import { SUBSTITUTE_TEST_CARDS } from './test-cards.fixtures';

const facts = (name: string) => extractCardFacts(SUBSTITUTE_TEST_CARDS[name]);
const texts = (q: string, c: string, role: string, deck: string[] = []) => {
  const qf = facts(q);
  const cf = facts(c);
  const s = scoreSubstitute(qf, cf, { idf: null }, { role, deck: deckProfile(deck.map(facts)) });
  return substituteFactors(qf, cf, s, { mana: 'all', edhrec: true }).map(
    (f) => `${f.tone}: ${f.text}`
  );
};

/** The sacrifice outlets the deck-context tests build around (real cards, real text). */
const OUTLETS = ['Viscera Seer', 'Carrion Feeder', "Ashnod's Altar"];

describe('tupleWords', () => {
  it('says what a trigger and its effect do, read off the card facts', () => {
    const pact = facts('Grave Pact');
    expect(tupleWords(pact, 'T:dies/creature/you>E:sacrifice/creature/opp')).toBe(
      'whenever a creature you control dies, each opponent sacrifices a creature'
    );
    expect(tupleWords(facts('Swords to Plowshares'), 'K:spell>E:exile/creature/any')).toBe(
      'exile target creature'
    );
    expect(tupleWords(facts('Counterspell'), 'K:spell>E:counter/spell/any')).toBe(
      'counter target spell'
    );
  });

  it('returns null rather than guess at a tuple it has no words for', () => {
    expect(tupleWords(facts('Grave Pact'), 'K:spell>E:exile/creature/any')).toBeNull();
  });
});

describe('substituteFactors', () => {
  it('leads with the shared effect in plain words', () => {
    expect(texts('Grave Pact', 'Dictate of Erebos', 'grave-pact')[0]).toBe(
      'pro: Same effect: whenever a creature you control dies, each opponent sacrifices a creature'
    );
  });

  it('names what the substitute gives up', () => {
    // Vindicate answers any permanent at sorcery speed; Swords only creatures, at instant speed.
    expect(texts('Vindicate', 'Swords to Plowshares', 'removal')).toEqual([
      'pro: Instant speed',
      'pro: Costs 2 less',
      'con: Hits creatures only',
    ]);
    expect(texts('Swords to Plowshares', 'Vindicate', 'removal')).toContain('con: Sorcery speed');
  });

  it('warns on the false friend instead of calling it the same effect', () => {
    const out = texts('Zulaport Cutthroat', 'Massacre Wurm', 'aristocrat-drain');
    expect(out.some((t) => t.startsWith('pro: Same effect'))).toBe(false);
    expect(out).toContain("con: Watches opponents' creatures, not yours");
  });

  it('names the deck link when the deck feeds the substitute', () => {
    expect(texts('Grave Pact', 'Dictate of Erebos', 'grave-pact', OUTLETS)).toContain(
      'pro: Pays off your sacrifice engine: 3 cards feed it'
    );
  });

  it('keeps every line inside the copy rules', () => {
    const all = [
      ...texts('Grave Pact', 'Butcher of Malakir', 'grave-pact', OUTLETS),
      ...texts('Vindicate', 'Swords to Plowshares', 'removal'),
      ...texts('Arcane Signet', 'Sol Ring', 'ramp'),
    ];
    for (const line of all) {
      expect(line).not.toMatch(/—|%|\.\.\.|!|\(e\.g\./);
      expect(line.length).toBeLessThanOrEqual(110);
    }
  });
});

describe('deck context', () => {
  it('counts the producers a payoff feeds on, minus the card leaving', () => {
    const deck = OUTLETS.map(facts);
    const fit = deckFit(facts('Grave Pact'), deckProfile(deck));
    expect(fit).toMatchObject({ side: 'payoff', resource: 'death', engine: 'sacrifice', count: 3 });
    // The outlet being swapped out no longer feeds anything.
    expect(deckFit(facts('Grave Pact'), deckProfile(deck, facts('Viscera Seer')))).toBeNull();
  });

  it('names no link below the support floor', () => {
    const deck = OUTLETS.slice(0, MIN_SUPPORT - 1).map(facts);
    expect(deckFit(facts('Grave Pact'), deckProfile(deck))).toBeNull();
  });

  it('raises a fitting card, by a bounded amount', () => {
    const q = facts('Grave Pact');
    const c = facts('Dictate of Erebos');
    const bare = scoreSubstitute(q, c, { idf: null }, { role: 'grave-pact' });
    const fed = scoreSubstitute(
      q,
      c,
      { idf: null },
      {
        role: 'grave-pact',
        deck: deckProfile(OUTLETS.map(facts)),
      }
    );
    expect(fed.score).toBeGreaterThan(bare.score);
    expect(fed.score - bare.score).toBeLessThanOrEqual(DECK_FIT_WEIGHT);
  });
});
