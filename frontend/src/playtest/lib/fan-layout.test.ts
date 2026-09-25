/**
 * The fan's spacing is the whole reason it reads as a hand: one fixed overlap
 * was wrong at both ends (seven cards bunched into an unreadable stack on a
 * 1920px table, fifteen ran under the zone piles). `fanOverlap` spreads the
 * cards into the width the table has left of the pile row, which is itself
 * four cards wide now that the piles match the hand's card size.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_FAN_OVERLAP,
  MIN_FAN_OVERLAP,
  fanCardWidth,
  fanOverlap,
  fanTilt,
  pilesWidth,
} from './fan-layout';

describe('pilesWidth', () => {
  it('is the Hand button and four tiles of the card width, plus their chrome and gaps', () => {
    expect(pilesWidth(100)).toBe(88 + 4 * 113 + 32 + 12);
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

/**
 * User report 2026-09-23, against EDHPlay: at 22 cards our fan's ends turned
 * 21° and dropped ~130px, off the table edge, where EDHPlay's big hand runs
 * nearly flat. The edge card's tilt is capped, so the fan flattens as it grows.
 */
describe('fanTilt', () => {
  const edge = (n: number) => fanTilt(n - 1, n);

  it('leaves a normal hand its full curve', () => {
    expect(edge(7)).toEqual({ deg: 6, drop: 1.2 * 9 });
    expect(fanTilt(3, 7)).toEqual({ deg: 0, drop: 0 });
  });

  it('keeps the ends of a big hand nearly flat and on the table', () => {
    for (const n of [8, 12, 22, 40]) {
      expect(edge(n).deg).toBeLessThanOrEqual(6 + 1e-9);
      expect(edge(n).drop).toBeLessThanOrEqual(12 + 1e-9);
    }
  });

  it('mirrors about the centre', () => {
    expect(fanTilt(0, 22).deg).toBeCloseTo(-edge(22).deg);
    expect(fanTilt(0, 22).drop).toBeCloseTo(edge(22).drop);
  });
});

describe('fanCardWidth', () => {
  it('keeps a normal hand at the table card size', () => {
    expect(fanCardWidth(7, 116, 1656)).toBe(116);
  });

  it('shrinks a big hand until, at the tightest overlap, it fits the room it has', () => {
    const handW = fanCardWidth(22, 116, 1656);
    expect(handW).toBeLessThan(116);
    expect(fanOverlap(22, 116, 1656, handW)).toBeCloseTo(MAX_FAN_OVERLAP);
    const fanWidth = handW * (1 + 21 * (1 - MAX_FAN_OVERLAP));
    expect(fanWidth).toBeLessThanOrEqual(1656 - pilesWidth(116));
  });

  it('leaves a phone hand alone, where the pile row leaves no band to fit', () => {
    expect(fanCardWidth(7, 56, 390)).toBe(56);
  });

  // A phone on its side (832px wide, a 810px felt): the hand is 84px while
  // the table is 56, and the row beside the fan is two 56px piles and the
  // Hand button, 232px as the stylesheet sizes it. Measured against the desk
  // row at the hand's size instead, seven cards overlapped 60%.
  it('fans a phone hand over the pile row the stylesheet states', () => {
    const [cardW, wrapW, piles] = [84, 810, 232];
    expect(fanCardWidth(7, cardW, wrapW, piles)).toBe(cardW);
    const overlap = fanOverlap(7, cardW, wrapW, cardW, piles);
    expect(overlap).toBeLessThan(0.35);
    expect(overlap).toBeLessThan(fanOverlap(7, cardW, wrapW));
    expect(cardW * (1 + 6 * (1 - overlap))).toBeLessThanOrEqual(wrapW - piles);
  });

  it('never shrinks a card below half the table size', () => {
    expect(fanCardWidth(60, 116, 1024)).toBeCloseTo(116 * 0.5);
  });
});
