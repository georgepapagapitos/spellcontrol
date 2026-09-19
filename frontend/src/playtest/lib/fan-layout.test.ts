/**
 * The fan's spacing is the whole reason it reads as a hand: one fixed overlap
 * was wrong at both ends (seven cards bunched into an unreadable stack on a
 * 1920px table, fifteen ran under the zone piles). `fanOverlap` spreads the
 * cards into the width the table actually has, between the log dock's
 * reserved band on the left and the pile row on the right.
 */
import { describe, expect, it } from 'vitest';
import { fanOverlap } from './fan-layout';

describe('fanOverlap', () => {
  it('spreads a normal hand to nearly side by side on a wide table', () => {
    // 1920px, seven cards at the 134px density: room to breathe.
    expect(fanOverlap(7, 134, 1920)).toBeLessThan(0.2);
  });

  it('still lays seven cards out on a 1440px table', () => {
    const overlap = fanOverlap(7, 100, 1440);
    expect(overlap).toBeLessThan(0.3);
    expect(overlap).toBeGreaterThanOrEqual(0.12);
  });

  it('tightens as the hand grows rather than running off the table', () => {
    const seven = fanOverlap(7, 100, 1440);
    const fifteen = fanOverlap(15, 100, 1440);
    expect(fifteen).toBeGreaterThan(seven);
    // Never past the density the board shipped with, which is known to fit at
    // the tightest table width.
    expect(fifteen).toBeLessThanOrEqual(0.45);
  });

  it('never exceeds the known-good ceiling at the tightest table width', () => {
    expect(fanOverlap(15, 90, 1024)).toBeLessThanOrEqual(0.45);
  });

  it('is a no-op for a hand that cannot overlap itself', () => {
    expect(fanOverlap(1, 100, 1440)).toBe(0.12);
    expect(fanOverlap(0, 100, 1440)).toBe(0.12);
  });
});
