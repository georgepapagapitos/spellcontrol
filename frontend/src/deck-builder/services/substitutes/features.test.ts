import { describe, expect, it } from 'vitest';
import { extractCardFacts } from '../cardFacts/extract';
import {
  cardTags,
  pairFeatures,
  primaryRole,
  roleAbilities,
  roleTags,
  tupleShape,
  tupleTags,
  type FeatureSources,
} from './features';
import { TEST_CARDS } from '../cardFacts/test-cards.fixtures';
import { SUBSTITUTE_WEIGHTS, linearScore } from './ranker';
import { SUBSTITUTE_TEST_CARDS } from './test-cards.fixtures';

const facts = (name: string) => extractCardFacts(SUBSTITUTE_TEST_CARDS[name]);
const NONE: FeatureSources = { idf: null };

describe('role-conditioned structure', () => {
  it('reads the Grave Pact family as one effect, the same polarity on both sides', () => {
    const { x, evidence } = pairFeatures(
      facts('Grave Pact'),
      facts('Dictate of Erebos'),
      'grave-pact',
      NONE
    );
    expect(evidence.sharedTuples).toContain('T:dies/creature/you>E:sacrifice/creature/opp');
    expect(x.sameEffect).toBe(1);
    expect(x.polarity).toBe(0);
    expect(x.roleStrength).toBe(1);
  });

  it('flags the false friend: the same drain on opposing creatures dying', () => {
    // Zulaport pays off YOUR creatures dying; Massacre Wurm, an opponent's.
    const { x, evidence } = pairFeatures(
      facts('Zulaport Cutthroat'),
      facts('Massacre Wurm'),
      'aristocrat-drain',
      NONE
    );
    expect(x.sameEffect).toBe(0);
    expect(x.polarity).toBe(1);
    expect(evidence.polarityClash).toMatch(/^T:dies\/creature\/you>E:lose-life/);
    expect(x.roleStrength).toBe(0);
  });

  it('never calls "any creature" the opposite of "your creature"', () => {
    // Blood Artist watches every creature, yours included: a superset, not a flip.
    const { x } = pairFeatures(
      facts('Zulaport Cutthroat'),
      facts('Blood Artist'),
      'aristocrat-drain',
      NONE
    );
    expect(x.polarity).toBe(0);
    expect(x.roleStrength).toBe(1);
  });

  it('compares only the abilities that carry the role', () => {
    const mindStone = facts('Mind Stone');
    // Mind Stone's draw ability is not part of it as a mana rock.
    expect(roleAbilities(mindStone, 'ramp')).toEqual([0]);
    expect(roleTags(mindStone, 'ramp').some((t) => t.startsWith('E:draw'))).toBe(false);
    expect(cardTags(mindStone).some((t) => t.startsWith('E:draw'))).toBe(true);
    const rock = pairFeatures(mindStone, facts('Arcane Signet'), 'ramp', NONE).x;
    const whole = pairFeatures(mindStone, facts('Arcane Signet'), '', NONE).x;
    expect(rock.roleTags).toBeGreaterThan(whole.roleTags);
  });

  it('scores a narrower answer below the same-scope one', () => {
    const vindicate = facts('Vindicate');
    const narrower = pairFeatures(vindicate, facts('Swords to Plowshares'), 'removal', NONE).x;
    const same = pairFeatures(
      facts('Swords to Plowshares'),
      facts('Path to Exile'),
      'removal',
      NONE
    ).x;
    expect(same.interaction).toBe(1);
    expect(narrower.interaction).toBeLessThan(1);
    expect(narrower.interaction).toBeGreaterThan(0);
  });

  it('keeps mana value and type as their own signals', () => {
    const { x } = pairFeatures(facts('Arcane Signet'), facts('Sol Ring'), 'ramp', NONE);
    expect(x.mv).toBe(0.5);
    expect(x.type).toBe(1);
  });
});

describe('injected signals', () => {
  it('reads EDHREC similar lists in either direction, through the front face', () => {
    const lists = new Map([['Grave Pact', new Map([['Dictate of Erebos', 2]])]]);
    const src: FeatureSources = { idf: null, similarRank: (n) => lists.get(n) ?? null };
    expect(
      pairFeatures(facts('Grave Pact'), facts('Dictate of Erebos'), 'grave-pact', src).x.edhrec
    ).toBe(1 / 3);
    const back = pairFeatures(facts('Dictate of Erebos'), facts('Grave Pact'), 'grave-pact', src);
    expect(back.evidence.similarRank).toBe(2);
    expect(
      pairFeatures(facts('Blood Artist'), facts('Grave Pact'), 'grave-pact', src).x.edhrec
    ).toBe(0);
  });

  it('matches tagger role, subtype and tags by name', () => {
    const tags: Record<string, string[]> = {
      'Arcane Signet': ['ramp', 'mana-rock'],
      'Mind Stone': ['ramp', 'mana-rock', 'draw'],
    };
    const src: FeatureSources = {
      idf: null,
      taggerRole: () => 'ramp',
      taggerSubtype: () => 'mana-rock',
      taggerTags: (n) => tags[n] ?? [],
    };
    const { x } = pairFeatures(facts('Arcane Signet'), facts('Mind Stone'), 'ramp', src);
    expect(x).toMatchObject({ taggerRole: 1, taggerSub: 1, taggerTags: 2 / 3 });
  });

  it('weighs a shared rare tag above a shared common one when IDF is given', () => {
    const q = facts('Grave Pact');
    const c = facts('Butcher of Malakir');
    const idf = new Map(
      [...cardTags(q), ...cardTags(c)].map((t) => [t, t.includes('>') ? 5 : 0.1])
    );
    const plain = pairFeatures(q, c, 'grave-pact', NONE).x.cardTags;
    const weighted = pairFeatures(q, c, 'grave-pact', { idf }).x.cardTags;
    expect(weighted).toBeGreaterThan(plain);
  });
});

describe('tuple helpers', () => {
  it('strip polarity but keep scope in a tuple shape', () => {
    expect(tupleShape('T:dies/creature/you>E:sacrifice/creature/opp')).toBe(
      'T:dies/creature/>E:sacrifice/creature/'
    );
    expect(tupleShape('K:spell>E:destroy/creature/each@mass')).toBe(
      'K:spell>E:destroy/creature/@mass'
    );
  });

  it('keep only full tuples, never their ancestors', () => {
    const tuples = tupleTags(cardTags(facts('Grave Pact')));
    expect(tuples).toEqual(['T:dies/creature/you>E:sacrifice/creature/opp']);
  });
});

describe('object filters narrow a substitute (E517)', () => {
  const removal = (name: string) => extractCardFacts(TEST_CARDS[name]);
  const narrowing = (q: string, c: string) =>
    pairFeatures(removal(q), removal(c), 'removal', NONE).x.narrowing;

  it('charges a substitute for hitting less of the board than the card it replaces', () => {
    // Plummet only kills flyers, Hero's Demise only legends, Kill Shot only attackers.
    expect(narrowing('Murder', 'Plummet')).toBeCloseTo(0.5);
    expect(narrowing('Murder', "Hero's Demise")).toBeCloseTo(0.65);
    expect(narrowing('Murder', 'Kill Shot')).toBeCloseTo(0.4);
  });

  it('charges nothing for hitting more, or the same', () => {
    expect(narrowing('Plummet', 'Murder')).toBe(0);
    expect(narrowing('Plummet', 'Plummet')).toBe(0);
    expect(narrowing('Murder', 'Cast Down')).toBe(0);
    // A color restriction is not narrowing: Doom Blade is Murder's equal.
    expect(narrowing('Murder', 'Doom Blade')).toBe(0);
  });

  it('lowers the score, so Plummet ranks under Murder as a stand-in for Murder', () => {
    const score = (c: string) =>
      linearScore(
        pairFeatures(removal('Doom Blade'), removal(c), 'removal', NONE).x,
        SUBSTITUTE_WEIGHTS
      );
    expect(score('Murder')).toBeGreaterThan(score('Plummet'));
    expect(score('Murder')).toBeGreaterThan(score("Hero's Demise"));
  });
});

describe('primaryRole', () => {
  it('names the job a card is replaced as', () => {
    expect(primaryRole(facts('Swords to Plowshares'))).toBe('removal');
    expect(primaryRole(facts('Counterspell'))).toBe('counterspell');
    // No counted role: the strongest named function, never a body trait.
    expect(primaryRole(facts('Blood Artist'))).toBe('aristocrat-drain');
    expect(primaryRole(facts('Viscera Seer'))).toBe('sac-outlet');
  });
});
