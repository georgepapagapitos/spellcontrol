/**
 * The fan's spacing is the whole reason it reads as a hand: one fixed overlap
 * was wrong at both ends (seven cards bunched into an unreadable stack on a
 * 1920px table, fifteen ran under the zone piles). `fanOverlap` spreads the
 * cards into the width the table has left of the pile row, which is itself
 * four cards wide now that the piles match the hand's card size.
 */
import { describe, expect, it } from 'vitest';
import { MAX_FAN_OVERLAP, MIN_FAN_OVERLAP, fanOverlap, pilesWidth } from './fan-layout';

describe('pilesWidth', () => {
  it('is four tiles of the card width plus their chrome and gaps', () => {
    expect(pilesWidth(100)).toBe(4 * 113 + 24 + 12);
  });
});

describe('fanOverlap', () => {
  it('spreads a normal hand to nearly side by side on a wide table', () => {
    // 1920px, seven cards at the 134px density: room to breathe.
    expect(fanOverlap(7, 134, 1920)).toBeLessThan(0.2);
  });

  it('tucks seven cards on a 1440px table rather than running under the piles', () => {
    const overlap = fanOverlap(7, 100, 1440);
    const fanWidth = 100 * (1 + 6 * (1 - overlap));
    expect(fanWidth).toBeLessThanOrEqual(1440 - pilesWidth(100));
    expect(overlap).toBeGreaterThanOrEqual(MIN_FAN_OVERLAP);
  });

  it('tightens as the hand grows', () => {
    const seven = fanOverlap(7, 100, 1440);
    const fifteen = fanOverlap(15, 100, 1440);
    expect(fifteen).toBeGreaterThan(seven);
    expect(fifteen).toBeLessThanOrEqual(MAX_FAN_OVERLAP);
  });

  it('never exceeds the ceiling at the tightest table width', () => {
    expect(fanOverlap(15, 90, 1024)).toBe(MAX_FAN_OVERLAP);
  });

  it('is a no-op for a hand that cannot overlap itself', () => {
    expect(fanOverlap(1, 100, 1440)).toBe(MIN_FAN_OVERLAP);
    expect(fanOverlap(0, 100, 1440)).toBe(MIN_FAN_OVERLAP);
  });
});
