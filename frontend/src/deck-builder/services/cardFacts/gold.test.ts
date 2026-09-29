/**
 * Accuracy ratchet for card facts, like the coverage floors: each floor is the
 * value measured when it was set. Raise a floor when a change lifts the
 * number; never lower one to make a change pass (fix the extractor or, if a
 * label is wrong, fix the label and say why in the commit).
 *
 * Two sets, read differently:
 *  - GOLD (dev, 235 cards) was labeled while the extractor was being written
 *    and tuned against: its numbers show nothing regressed, not how good the
 *    extractor is.
 *  - HOLDOUT (100 random commander-legal cards) was labeled blind. Its FIRST
 *    run, before any rule change had seen it, is the honest estimate:
 *
 *      roles precision 0.833 [0.721, 0.930]   recall 0.778 [0.651, 0.894]
 *      roles tier      0.667 [0.529, 0.818]   speed 0.961   repeat 0.941
 *      interaction P   1.000                  recall 0.783 [0.571, 0.923]
 *      flows precision 0.929 [0.840, 1.000]   recall 0.907 [0.810, 0.977]
 *      (percentile bootstrap, 300 resamples of cards, seed 512)
 *
 *    The extractor was then fixed on generic rules those misses exposed, so
 *    the floors below are post-fix and no longer blind. A new blind estimate
 *    needs a new random draw (see gold.holdout.fixtures.ts).
 */
import { describe, expect, it } from 'vitest';
import { benchmark, bootstrapCI, HEADLINE, totals, type BenchTotals } from './bench';
import { extractCardFacts } from './extract';
import { GOLD } from './gold.fixtures';
import { HOLDOUT } from './gold.holdout.fixtures';

const run = (set: typeof GOLD) => benchmark(set, (g) => extractCardFacts(g.card, g.tags));

const FLOORS: Record<'dev' | 'holdout', Record<keyof typeof HEADLINE, number>> = {
  dev: {
    'roles.precision': 1,
    'roles.recall': 1,
    'roles.tier': 0.975,
    'roles.speed': 1,
    'roles.repeat': 1,
    'interaction.precision': 1,
    'interaction.recall': 1,
    'interaction.hits': 1,
    'interaction.side': 1,
    'flows.precision': 1,
    'flows.recall': 1,
  },
  holdout: {
    'roles.precision': 0.957,
    'roles.recall': 1,
    'roles.tier': 0.849,
    'roles.speed': 1,
    'roles.repeat': 1,
    'interaction.precision': 1,
    'interaction.recall': 1,
    'interaction.hits': 1,
    'interaction.side': 1,
    'flows.precision': 0.977,
    'flows.recall': 1,
  },
};

describe.each([
  ['dev', GOLD],
  ['holdout', HOLDOUT],
] as const)('card facts accuracy: %s set', (set, cards) => {
  const scores = run(cards);
  const t: BenchTotals = totals(scores);

  it.each(Object.keys(HEADLINE) as (keyof typeof HEADLINE)[])('%s holds its floor', (metric) => {
    const value = HEADLINE[metric](t);
    const floor = FLOORS[set][metric];
    // Floors are stored to three places; compare at that precision.
    expect(
      Math.floor(value * 1000) / 1000,
      `${metric} = ${value.toFixed(4)}`
    ).toBeGreaterThanOrEqual(floor);
  });

  it('never confuses a counterspell for removal, or reads a polarity backwards', () => {
    expect(t.buckets.polarity).toBe(0);
    expect(t.buckets['role-confusion']).toBe(0);
  });

  it('reports a reproducible confidence interval', () => {
    const a = bootstrapCI(scores, HEADLINE['roles.tier'], 200);
    const b = bootstrapCI(scores, HEADLINE['roles.tier'], 200);
    expect(a).toEqual(b);
    expect(a[0]).toBeLessThanOrEqual(HEADLINE['roles.tier'](t));
    expect(a[1]).toBeGreaterThanOrEqual(HEADLINE['roles.tier'](t));
  });
});
