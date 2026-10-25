// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { card } from '@/deck-builder/services/deckBuilder/deckObjective/__fixtures__/objectiveFixture';
import type { Change } from './deck-change';
import { PRICE_FLOOR, rankBuys, type BuyCandidate } from './coach-buys';

const buy = (cutName: string, inName: string, delta: number): BuyCandidate => ({
  cutName,
  delta,
  change: {
    id: `upgrade:cut:${cutName}`,
    type: 'swap',
    lane: 'upgrade',
    name: card(inName).name,
    inName: cutName,
    ownership: 'unowned',
  } as Change,
});

describe('rankBuys', () => {
  const buys = [
    buy('Skull Prophet', 'Demonic Tutor', 6),
    buy('Dread Return', 'Cultivate', 3),
    buy('Skullclamp', 'Gilded Lotus', 9),
    buy('Life // Death', 'Grave Pact', 4),
  ];
  const prices: Record<string, number> = {
    'Demonic Tutor': 3,
    Cultivate: 0.5,
    'Gilded Lotus': 12,
  };

  it('ranks by objective gain per dollar, not by gain', () => {
    const { ranked } = rankBuys(buys, (n) => prices[n], 3);
    expect(ranked.map((b) => b.change.name)).toEqual([
      'Cultivate',
      'Demonic Tutor',
      'Gilded Lotus',
    ]);
    expect(ranked[0].perDollar).toBeCloseTo(6);
    expect(ranked[1].perDollar).toBeCloseTo(2);
  });

  it('counts a card with no price instead of guessing one', () => {
    const r = rankBuys(buys, (n) => prices[n], 10);
    expect(r.unpriced).toBe(1);
    expect(r.ranked.map((b) => b.change.name)).not.toContain('Grave Pact');
  });

  it('treats a missing price as unknown, not as free', () => {
    const r = rankBuys([buy('Skullclamp', 'Grave Pact', 9)], () => undefined);
    expect(r).toEqual({ ranked: [], unpriced: 1 });
  });

  it('floors a bulk price so a $0.05 card does not outrank on rounding alone', () => {
    const { ranked } = rankBuys([buy('Skullclamp', 'Cultivate', 1)], () => 0.05);
    expect(ranked[0].perDollar).toBeCloseTo(1 / PRICE_FLOOR);
  });

  it('skips a swap that is not a gain, and offers one card once', () => {
    const r = rankBuys(
      [buy('A', 'Cultivate', 0), buy('B', 'Cultivate', 2), buy('C', 'Cultivate', 5)],
      () => 1,
      5
    );
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0].cutName).toBe('B');
  });
});
