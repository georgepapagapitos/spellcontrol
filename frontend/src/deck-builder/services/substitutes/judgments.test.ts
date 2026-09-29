import { describe, expect, it } from 'vitest';
import { SUBSTITUTES } from '../cardFacts/substitutes.fixtures';
import { JUDGMENTS } from './judgments.fixtures';

// The pooled judgments are the substitute eval's ground truth
// (scripts/substitute-eval.mjs). A malformed row would silently skew every
// number the eval prints, so the table's shape is pinned here.
describe('pooled substitute judgments', () => {
  const queries = new Set(SUBSTITUTES.flatMap((r) => [`${r.a}|${r.role}`, `${r.b}|${r.role}`]));

  it('grade only lane B queries, each pair once, never a card against itself', () => {
    const seen = new Set<string>();
    for (const j of JUDGMENTS) {
      expect(queries.has(`${j.q}|${j.role}`), `${j.q} as ${j.role}`).toBe(true);
      expect(j.c).not.toBe(j.q);
      const key = `${j.q}|${j.role}|${j.c}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('never re-grade a pair lane B already graded', () => {
    const laneB = new Set(
      SUBSTITUTES.flatMap((r) => [`${r.a}|${r.role}|${r.b}`, `${r.b}|${r.role}|${r.a}`])
    );
    for (const j of JUDGMENTS) expect(laneB.has(`${j.q}|${j.role}|${j.c}`)).toBe(false);
  });

  it('keep an adjudicated grade within reach of the two annotators', () => {
    for (const j of JUDGMENTS) {
      expect([0, 1, 2, 3]).toContain(j.grade);
      if (!j.ab) continue;
      const [a, b] = j.ab;
      expect(a).not.toBe(b);
      expect(j.grade).toBeGreaterThanOrEqual(Math.min(a, b));
      expect(j.grade).toBeLessThanOrEqual(Math.max(a, b));
    }
  });
});
