// Pins the metric and sampling functions of the held-out card-recovery
// benchmark (recall-benchmark-lib.mjs) on hand-computed cases.
import { describe, expect, it } from 'vitest';
import {
  dedupeByJaccard,
  hashSeed,
  jaccard,
  meanMetrics,
  nameKey,
  pickRandom,
  pickRoleStratified,
  queryMetrics,
  rankPool,
  rng,
  splitByPopularity,
  tailShare,
} from './recall-benchmark-lib.mjs';

const pool = Array.from({ length: 30 }, (_, i) => `c${i + 1}`); // c1 is rank 1

describe('queryMetrics', () => {
  it('scores a single hit at rank 1 as perfect', () => {
    expect(queryMetrics(pool, ['c1'])).toEqual({
      n: 1,
      'recall@10': 1,
      'recall@20': 1,
      'ndcg@20': 1,
      mrr: 1,
    });
  });

  it('computes recall, nDCG and MRR for hits at ranks 2, 15 and 25', () => {
    const m = queryMetrics(pool, ['c2', 'c15', 'c25']);
    expect(m['recall@10']).toBeCloseTo(1 / 3);
    expect(m['recall@20']).toBeCloseTo(2 / 3);
    const dcg = 1 / Math.log2(3) + 1 / Math.log2(16); // rank 25 is past the cutoff
    const ideal = 1 + 1 / Math.log2(3) + 1 / Math.log2(4);
    expect(m['ndcg@20']).toBeCloseTo(dcg / ideal, 10);
    expect(m.mrr).toBeCloseTo(0.5);
  });

  it('caps the ideal list at k hits when more than k cards are hidden', () => {
    const all = pool.slice(0, 25);
    const m = queryMetrics(pool, all);
    expect(m['ndcg@20']).toBeCloseTo(1, 10);
    expect(m['recall@20']).toBeCloseTo(20 / 25);
  });

  it('scores a hit outside the list window as zero but keeps MRR', () => {
    const m = queryMetrics(pool, ['c30']);
    expect(m['recall@20']).toBe(0);
    expect(m['ndcg@20']).toBe(0);
    expect(m.mrr).toBeCloseTo(1 / 30);
  });

  it('returns null when nothing is relevant and zero for a missing card', () => {
    expect(queryMetrics(pool, [])).toBeNull();
    expect(queryMetrics(pool, ['nope']).mrr).toBe(0);
  });
});

describe('splitByPopularity and tailShare', () => {
  const pct = { a: 55, b: 10, c: 9.99, d: 0 };
  const of = (n) => pct[n] ?? 0;

  it('puts exactly 10 percent in the head and anything below in the tail', () => {
    expect(splitByPopularity(['a', 'b', 'c', 'd', 'zzz'], of)).toEqual({
      head: ['a', 'b'],
      tail: ['c', 'd', 'zzz'],
    });
  });

  it('measures the tail share of the top k only', () => {
    expect(tailShare(['a', 'c', 'b', 'd'], of, 2)).toBe(0.5);
    expect(tailShare([], of)).toBe(0);
  });
});

describe('meanMetrics', () => {
  it('averages over live rows and ignores null (empty bucket) rows', () => {
    const m = meanMetrics([
      { n: 1, mrr: 1, 'recall@10': 0 },
      null,
      { n: 3, mrr: 0.5, 'recall@10': 1 },
    ]);
    expect(m).toEqual({ queries: 2, mrr: 0.75, 'recall@10': 0.5 });
  });
});

describe('rankPool', () => {
  it('orders by score and breaks ties with the seeded random key', () => {
    const score = (n) => (n === 'x' ? 5 : 0);
    const names = ['a', 'b', 'c', 'x', 'd'];
    const one = rankPool(names, score, rng(7));
    const two = rankPool(names, score, rng(7));
    expect(one[0]).toBe('x');
    expect(one).toEqual(two);
    expect([...one].sort()).toEqual([...names].sort());
  });
});

describe('sampling', () => {
  const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
  const role = (n) => (+n.slice(1) < 4 ? 'ramp' : +n.slice(1) < 8 ? 'removal' : null);

  it('picks the same cards for the same seed and different ones otherwise', () => {
    expect(pickRandom(names, 5, rng(1))).toEqual(pickRandom(names, 5, rng(1)));
    expect(pickRandom(names, 5, rng(1))).not.toEqual(pickRandom(names, 5, rng(2)));
    expect(new Set(pickRandom(names, 5, rng(1))).size).toBe(5);
  });

  it('draws one card per role group before repeating a group', () => {
    const got = pickRoleStratified(names, 3, role, rng(3));
    expect(new Set(got.map((n) => role(n) ?? '_other')).size).toBe(3);
  });

  it('returns what exists when k exceeds the deck', () => {
    expect(pickRoleStratified(['a', 'b'], 5, () => null, rng(1)).sort()).toEqual(['a', 'b']);
  });

  it('hashes seeds stably', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});

describe('jaccard and dedupeByJaccard', () => {
  it('computes the overlap ratio', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5);
    expect(jaccard([], [])).toBe(1);
  });

  it('drops a later deck above 0.9 overlap and keeps one at exactly 0.9', () => {
    const base = Array.from({ length: 99 }, (_, i) => `c${i}`);
    const near = [...base.slice(0, 98), 'other']; // 98 / 100 = 0.98
    const edge = [...base.slice(0, 90), ...Array.from({ length: 9 }, (_, i) => `z${i}`)]; // 90 / 108
    const decks = [base, near, edge].map((c) => ({ keys: new Set(c) }));
    const kept = dedupeByJaccard(decks, 0.9);
    expect(kept).toHaveLength(2);
    expect(kept[1]).toBe(decks[2]);
  });
});

describe('nameKey', () => {
  it('folds front face, curly quotes and case', () => {
    expect(nameKey('Jace, Vryn’s Prodigy // Jace, Telepath Unbound')).toBe("jace, vryn's prodigy");
  });
});
