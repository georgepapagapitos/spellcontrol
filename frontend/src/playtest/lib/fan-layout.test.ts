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
  fanGapShift,
  fanInsertIndex,
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

  // An upright phone (a 390px wrap): the piles stand above the hand, so
  // nothing shares its row. Beside the two piles, seven cards had 198px and
  // the 52% cap, and shrank to 58px. The whole edge less the end cards'
  // swing, which ran them off the screen by 7px when it was not taken off.
  it('gives an upright phone hand the whole edge when no row stands beside it', () => {
    const [cardW, wrapW] = [86, 390];
    const swing = cardW * 1.4 * Math.sin(Math.PI / 30);
    const room = wrapW - 24 - 2 * swing;
    expect(fanCardWidth(7, cardW, wrapW, 0)).toBe(cardW);
    const overlap = fanOverlap(7, cardW, wrapW, cardW, 0);
    expect(overlap).toBeLessThan(MAX_FAN_OVERLAP);
    expect(cardW * (1 + 6 * (1 - overlap))).toBeCloseTo(room);
    expect(room + 2 * swing).toBeLessThanOrEqual(wrapW - 24);
    // A big hand still shrinks, to the whole edge rather than to the cap.
    const big = fanCardWidth(12, cardW, wrapW, 0);
    expect(big).toBeLessThan(cardW);
    expect(big * (1 + 11 * (1 - MAX_FAN_OVERLAP))).toBeCloseTo(room);
  });
});

describe('fanInsertIndex', () => {
  it('counts the cards whose centre is left of the held card', () => {
    const centers = [100, 200, 300];
    expect(fanInsertIndex(centers, 50)).toBe(0);
    expect(fanInsertIndex(centers, 150)).toBe(1);
    expect(fanInsertIndex(centers, 299)).toBe(2);
    expect(fanInsertIndex(centers, 900)).toBe(3);
    expect(fanInsertIndex([], 10)).toBe(0);
  });
});

/**
 * The gap a held card opens has to be the room it will actually take: the fan
 * is centred, so a card's resting x is `(i - (n - 1) / 2) * step`, and every
 * other card must already stand at its place in the NEW order while the gap
 * is open. Anything else and the drop throws the cards sideways and slides
 * them back.
 */
describe('fanGapShift', () => {
  const step = 60;
  const at = (i: number, n: number) => (i - (n - 1) / 2) * step;

  it('parts the cards either side of the gap', () => {
    expect(fanGapShift(0, 1, step)).toBe(-30);
    expect(fanGapShift(1, 1, step)).toBe(30);
  });

  it('puts every card where it lands when a card comes in from elsewhere', () => {
    const n = 5;
    for (let k = 0; k <= n; k++) {
      for (let i = 0; i < n; i++) {
        const landed = i < k ? i : i + 1;
        expect(at(i, n) + fanGapShift(i, k, step), `k=${k} i=${i}`).toBeCloseTo(at(landed, n + 1));
      }
    }
  });

  it("closes the lifted card's box and puts every other card where it lands when arranging", () => {
    const n = 5;
    for (let src = 0; src < n; src++) {
      const others = [...Array(n).keys()].filter((i) => i !== src);
      for (let k = 0; k < n; k++) {
        const order = [...others];
        order.splice(k, 0, src);
        for (const i of others) {
          expect(at(i, n) + fanGapShift(i, k, step, src), `src=${src} k=${k} i=${i}`).toBeCloseTo(
            at(order.indexOf(i), n)
          );
        }
      }
    }
  });

  it('leaves the lifted card itself alone: it is invisible while held', () => {
    expect(fanGapShift(2, 0, step, 2)).toBe(0);
  });
});
