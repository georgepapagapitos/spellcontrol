import { describe, expect, it } from 'vitest';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import { jaccard, mostSimilar, similarityTags, tagIdf, weightedJaccard } from './similarity';
import { TEST_CARDS } from './test-cards.fixtures';
import type { CardFacts } from './schema';

const gold = (name: string) => {
  const g = GOLD.find((x) => x.card.name === name)!;
  return extractCardFacts(g.card, g.tags);
};
const pool: CardFacts[] = [
  ...GOLD.map((g) => extractCardFacts(g.card, g.tags)),
  ...Object.values(TEST_CARDS).map((c) => extractCardFacts(c)),
];

describe('similarity tags', () => {
  it('carry the shared Grave Pact tuple, with its ancestors, and no numbers', () => {
    const tags = similarityTags(gold('Grave Pact'));
    expect(tags).toEqual(
      expect.arrayContaining([
        'T:dies',
        'T:dies/creature',
        'T:dies/creature/you',
        'T:dies/creature/you>E:sacrifice/creature/opp',
        'T:dies>E:sacrifice',
        'F:grave-pact',
        'R:removal',
        'Y:enchantment',
        'M:4',
      ])
    );
    expect(tags.filter((t) => !t.startsWith('M:')).some((t) => /\d/.test(t))).toBe(false);
    expect(tags).toEqual([...tags].sort());
  });

  it('fold a numeric limit into a number-free tag', () => {
    expect(similarityTags(gold('Despark'))).toContain('L:mv-floor');
  });
});

describe('jaccard', () => {
  it('scores identical sets 1 and disjoint sets 0', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBe(0.5);
  });

  it('weights rare tags above common ones', () => {
    const idf = tagIdf([['common', 'rare'], ['common'], ['common'], ['common']]);
    expect(weightedJaccard(['common', 'rare'], ['rare'], idf)).toBeGreaterThan(
      jaccard(['common', 'rare'], ['rare'])
    );
    expect(weightedJaccard(['x'], ['x'], idf)).toBe(1);
    expect(weightedJaccard([], [], idf)).toBe(0);
  });
});

describe('mostSimilar', () => {
  it('ranks the Grave Pact family together', () => {
    const top = mostSimilar(gold('Grave Pact'), pool, 3).map((x) => x.facts.name);
    expect(top.slice(0, 2).sort()).toEqual(['Butcher of Malakir', 'Dictate of Erebos']);
  });

  it('holds the query out, filters the pool and honors IDF weights', () => {
    const query = gold('Wrath of God');
    const idf = tagIdf(pool.map(similarityTags));
    const top = mostSimilar(query, pool, 5, { idf, filter: (f) => f.types.includes('sorcery') });
    expect(top.map((x) => x.facts.name)).not.toContain('Wrath of God');
    expect(top.every((x) => x.facts.types.includes('sorcery'))).toBe(true);
    expect(top[0].facts.name).toBe('Damnation');
    expect(top.map((x) => x.score)).toEqual([...top.map((x) => x.score)].sort((a, b) => b - a));
  });
});
