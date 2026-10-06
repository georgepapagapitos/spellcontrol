// @vitest-environment node
//
// The cooperative search (E513): the same swaps as the sync search, with the
// page given room to paint every few dozen ms of work, progress reported as it
// goes, and a time budget that counts work, not the waits.
import { describe, expect, it, vi } from 'vitest';
import { optimizeDeck, type Beat } from './optimizer';
import { optimizeDeckAsync } from './optimizerAsync';
import { BASELINE, TREATMENT, cards, merenCtx } from './__fixtures__/objectiveFixture';

const SMALL = { maxSwaps: 3, maxEvaluations: 40, shortlist: 12, escapes: 0 };
const pool = () => [
  ...BASELINE.cards,
  ...cards('Counterspell', 'Swords to Plowshares', 'Grave Pact', 'Pitiless Plunderer'),
];
const names = (r: { swaps: Array<{ in: string[]; out: string[] }> }) =>
  r.swaps.map((s) => `${s.in.join('+')}<-${s.out.join('+')}`);

describe('optimizeDeckAsync', { timeout: 120_000 }, () => {
  const ctx = merenCtx();

  it('makes the same swaps as the sync search, and the page gets room between them', async () => {
    const sync = optimizeDeck(TREATMENT, pool(), ctx, SMALL);
    // A macrotask that can only run if the search lets go of the thread.
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const beats: Beat[] = [];
    const async = await optimizeDeckAsync(TREATMENT, pool(), ctx, SMALL, (b) => beats.push(b));
    clearInterval(timer);
    expect(names(async)).toEqual(names(sync));
    expect(async.stoppedBy).toBe(sync.stoppedBy);
    expect(async.score.total).toBe(sync.score.total);
    expect(ticks).toBeGreaterThan(0);
    expect(beats.length).toBeGreaterThan(10);
    expect(beats.every((b) => b.maxEvaluations === SMALL.maxEvaluations)).toBe(true);
  });

  it('reports progress that only moves forward', async () => {
    const beats: Beat[] = [];
    await optimizeDeckAsync(TREATMENT, pool(), ctx, SMALL, (b) => beats.push(b));
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].evaluations).toBeGreaterThanOrEqual(beats[i - 1].evaluations);
      expect(beats[i].swaps).toBeGreaterThanOrEqual(beats[i - 1].swaps);
    }
  });

  it('stops at its time budget with the swaps it has, valid and in order', async () => {
    const r = await optimizeDeckAsync(TREATMENT, pool(), ctx, { ...SMALL, timeBudgetMs: -1 });
    expect(r.stoppedBy).toBe('time');
    expect(r.swaps).toEqual([]);
  });

  it('does not count the waits against its budget', async () => {
    // Every wait moves the clock a day; the work is seconds. A search that
    // counted its waits would stop at the first one.
    const realNow = Date.now.bind(Date);
    let skew = 0;
    let waited = 0;
    const g = globalThis as { scheduler?: { yield: () => Promise<void> } };
    const before = g.scheduler;
    g.scheduler = {
      yield: async () => {
        waited++;
        skew += 86_400_000;
      },
    };
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    try {
      const r = await optimizeDeckAsync(TREATMENT, pool(), ctx, {
        ...SMALL,
        timeBudgetMs: 600_000,
      });
      expect(waited).toBeGreaterThan(0);
      expect(r.stoppedBy).not.toBe('time');
      expect(r.swaps.length).toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
      g.scheduler = before;
    }
  });
});
