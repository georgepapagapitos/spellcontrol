import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSpeed, shareByTurn, SPEED_MIN_RUNS, TURN_EXPECTATIONS, usableClock } from './speed';
import { estimateBracket, createTagLookup, SOFT_SCORE, softScorePoints } from './index';

// Real clocks: the assembly clock run over tournament cEDH lists and precons
// (calibration/fixtures/clock-signals.json).
const signals = JSON.parse(
  fs.readFileSync(new URL('../calibration/fixtures/clock-signals.json', import.meta.url), 'utf8')
) as Record<string, { clock: { runs: number; median: number; assembledBy: number[] } | null }>;
const real = Object.values(signals).filter((s) => s.clock);

describe('turn expectations', () => {
  it("are Wizards' October 21, 2025 minimums", () => {
    expect(TURN_EXPECTATIONS).toEqual({ 1: 9, 2: 8, 3: 6, 4: 4, 5: 1 });
  });
});

describe('readSpeed', () => {
  it('reads "before turn 6" for Bracket 3 as the share assembled by turn 5', () => {
    const clock = { runs: 1000, assembledBy: [0, 0, 0.01, 0.05, 0.1, 0.22, 0.3, 0.4] };
    const r = readSpeed(clock, 3)!;
    expect(r).toMatchObject({
      bracket: 3,
      expectedTurn: 6,
      beforeTurn: 6,
      share: 0.22,
      runs: 1000,
    });
    expect(r.low).toBeLessThan(0.22);
    expect(r.high).toBeGreaterThan(0.22);
    expect(r.high - r.low).toBeLessThan(0.06);
  });

  it('reads Bracket 5 against turn 4 and says it expects nothing', () => {
    const r = readSpeed({ runs: 1000, assembledBy: [0, 0, 0.1, 0.2, 0.3, 0.4, 0.5] }, 5)!;
    expect(r).toMatchObject({ expectedTurn: null, beforeTurn: 4, share: 0.2 });
  });

  it('has nothing to say without enough games or turns', () => {
    expect(readSpeed(null, 3)).toBeNull();
    expect(
      readSpeed({ runs: SPEED_MIN_RUNS - 1, assembledBy: [0, 0, 0, 0, 0, 0, 0] }, 3)
    ).toBeNull();
    expect(readSpeed({ runs: 1000, assembledBy: [0, 0, 0] }, 3)).toBeNull();
    expect(usableClock(undefined)).toBe(false);
  });

  it('keeps a share inside [0, 1] and reads past the end as zero', () => {
    expect(shareByTurn({ runs: 1000, assembledBy: [0, 1.2] }, 1)).toBe(1);
    expect(shareByTurn({ runs: 1000, assembledBy: [0, 0.5] }, 9)).toBe(0);
  });

  it('reads every real clock: monotone shares, an interval around each', () => {
    expect(real.length).toBeGreaterThan(40);
    for (const s of real) {
      const c = s.clock!;
      for (let t = 1; t < c.assembledBy.length; t++) {
        expect(c.assembledBy[t]).toBeGreaterThanOrEqual(c.assembledBy[t - 1]);
      }
      for (const b of [1, 2, 3, 4, 5]) {
        const r = readSpeed(c, b)!;
        expect(r.low).toBeLessThanOrEqual(r.share + 1e-9);
        expect(r.high).toBeGreaterThanOrEqual(r.share - 1e-9);
      }
    }
  });
});

describe('the speed term in the soft score', () => {
  const NO_GC = new Set<string>();
  const tags = createTagLookup({});
  const names = ['Sol Ring', 'Command Tower'];
  const base = () => estimateBracket(names, [], 3, undefined, {}, NO_GC, tags);

  it('adds points scaled by the share assembled before turn 6, capped', () => {
    const fast = { runs: 1000, assembledBy: [0, 0.2, 0.5, 0.8, 0.9, 1, 1] };
    const slow = { runs: 1000, assembledBy: [0, 0, 0, 0, 0, 0.3, 0.5] };
    const without = base();
    const withFast = estimateBracket(names, [], 3, undefined, {}, NO_GC, tags, [], fast);
    const withSlow = estimateBracket(names, [], 3, undefined, {}, NO_GC, tags, [], slow);
    expect(withFast.softScore - without.softScore).toBe(SOFT_SCORE.speedCap);
    expect(Math.abs(withSlow.softScore - without.softScore - 3)).toBeLessThanOrEqual(1);
    expect(withFast.breakdown.earlyAssemblyShare).toBe(1);
    expect(withFast.breakdown.clockRuns).toBe(1000);
  });

  it('is never a floor and never a penalty: no clock, no change', () => {
    const none = base();
    const nullClock = estimateBracket(names, [], 3, undefined, {}, NO_GC, tags, [], null);
    const thin = estimateBracket(names, [], 3, undefined, {}, NO_GC, tags, [], {
      runs: 50,
      assembledBy: [0, 1, 1, 1, 1, 1, 1],
    });
    expect(nullClock).toEqual(none);
    expect(thin).toEqual(none);
    expect(none.breakdown.earlyAssemblyShare).toBeUndefined();
    expect(softScorePoints(none.breakdown).speed).toBe(0);
  });
});
