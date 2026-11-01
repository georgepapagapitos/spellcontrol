import { describe, expect, it, vi } from 'vitest';
import type { EDHRECCommanderData } from '@/deck-builder/types';
import {
  computeEdhrecRoleTargets,
  edhrecInclusionWeight,
  getDynamicRoleTargets,
} from './roleTargets';

vi.mock('@/deck-builder/services/tagger/client', () => ({
  // A card's role is its name's prefix: "ramp-3" is a ramp card.
  getCardRole: (name: string) => {
    const role = name.split('-')[0];
    return ['ramp', 'removal', 'boardwipe', 'cardDraw'].includes(role) ? role : null;
  },
}));

function page(cards: Array<[string, number]>): EDHRECCommanderData {
  return {
    cardlists: {
      allNonLand: cards.map(([name, inclusion]) => ({ name, inclusion })),
    },
  } as unknown as EDHRECCommanderData;
}

/** n cards of a role at one inclusion. */
function run(role: string, n: number, inclusion: number): Array<[string, number]> {
  return Array.from({ length: n }, (_, i) => [`${role}-${i}`, inclusion]);
}

const targetsOf = (cards: Array<[string, number]>) =>
  getDynamicRoleTargets(99, undefined, undefined, page(cards)).targets;

describe('role targets are smooth in inclusion (E1061)', () => {
  it('ramps a card in over 20% to 30% inclusion', () => {
    expect(edhrecInclusionWeight(19)).toBe(0);
    expect(edhrecInclusionWeight(20)).toBe(0);
    expect(edhrecInclusionWeight(25)).toBeCloseTo(0.5);
    expect(edhrecInclusionWeight(30)).toBe(1);
    expect(edhrecInclusionWeight(80)).toBe(1);
    expect(edhrecInclusionWeight(25, 40)).toBe(0);
  });

  it('rounds the soft count for integer callers', () => {
    const counts = computeEdhrecRoleTargets(page([...run('ramp', 3, 60), ['ramp-x', 25]]));
    expect(counts.ramp).toBe(4); // 3 + 0.5 rounds up
    expect(counts.cardDraw).toBe(0);
  });

  it('a card drifting 24.9 to 25.1 percent changes no target', () => {
    const base = [...run('ramp', 9, 60), ...run('removal', 7, 60), ...run('cardDraw', 8, 60)];
    for (const role of ['ramp', 'removal', 'cardDraw']) {
      const lo = targetsOf([...base, [`${role}-drift`, 24.9]]);
      const hi = targetsOf([...base, [`${role}-drift`, 25.1]]);
      expect(hi).toEqual(lo);
    }
  });

  it('one more role card does not move another role through the total cap', () => {
    // Over the 35-card cap, so every role is rescaled: with the old
    // round-then-rescale-then-round, a single cardDraw count moved ramp too.
    const base = [...run('ramp', 15, 60), ...run('removal', 16, 60), ...run('cardDraw', 9, 60)];
    const lo = targetsOf([...base, ['cardDraw-drift', 24.9]]);
    const hi = targetsOf([...base, ['cardDraw-drift', 25.1]]);
    expect(hi).toEqual(lo);
  });

  it('keeps the rounded total inside the cap and the floors', () => {
    const over = targetsOf([
      ...run('ramp', 30, 60),
      ...run('removal', 30, 60),
      ...run('cardDraw', 30, 60),
      ...run('boardwipe', 30, 60),
    ]);
    const sum = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
    expect(sum(over)).toBeLessThanOrEqual(Math.round(99 * 0.35));
    const empty = targetsOf([]);
    expect(sum(empty)).toBeGreaterThanOrEqual(Math.round(99 * 0.28));
    expect(empty.ramp).toBeGreaterThanOrEqual(1);
  });
});
