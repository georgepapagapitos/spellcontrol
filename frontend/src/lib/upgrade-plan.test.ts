import { describe, expect, it } from 'vitest';
import { planUpgrades, type UpgradePlanContext, type UpgradePlanOptions } from './upgrade-plan';
import type { Change } from './deck-change';

const add = (name: string, extra: Partial<Change> = {}): Change => ({
  id: `fill-gaps:${name}`,
  type: 'add',
  lane: 'fill-gaps',
  name,
  ownership: 'unowned',
  ...extra,
});
const cut = (name: string, extra: Partial<Change> = {}): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  ...extra,
});

function ctx(over: Partial<UpgradePlanContext> & { prices?: Record<string, number> } = {}) {
  const { prices = {}, ...rest } = over;
  const base: UpgradePlanContext = {
    moves: [],
    cuts: [cut('Filler A'), cut('Filler B'), cut('Filler C'), cut('Filler D')],
    roleCounts: {},
    roleTargets: {},
    openSlots: 0,
    priceOf: (n) => prices[n] ?? null,
    raisesBracket: (c) => c.isGameChanger === true,
    isGameChanger: (c) => c.isGameChanger === true,
    gameChangerRoom: 0,
    ceiling: 2,
  };
  return { ...base, ...rest };
}
const opts = (o: Partial<UpgradePlanOptions> = {}): UpgradePlanOptions => ({
  budget: 50,
  goal: 'hold',
  ownedFree: true,
  ...o,
});
const names = (plan: ReturnType<typeof planUpgrades>) => plan.picks.map((p) => p.change.name);

describe('planUpgrades', () => {
  it('takes moves in rank order, skips what does not fit, and keeps spending', () => {
    const plan = planUpgrades(
      ctx({
        moves: [add('Pricey'), add('Mid'), add('Cheap')],
        prices: { Pricey: 60, Mid: 30, Cheap: 15 },
      }),
      opts()
    );
    expect(names(plan)).toEqual(['Mid', 'Cheap']);
    expect(plan.spent).toBe(45);
    expect(plan.nextOverBudget).toEqual({
      change: expect.objectContaining({ name: 'Pricey' }),
      cost: 60,
    });
  });

  it('pairs every add with its own cut, weakest first', () => {
    const plan = planUpgrades(ctx({ moves: [add('A'), add('B')], prices: { A: 1, B: 1 } }), opts());
    expect(plan.picks.map((p) => p.cutName)).toEqual(['Filler A', 'Filler B']);
  });

  it('fills empty slots before cutting anything', () => {
    const plan = planUpgrades(
      ctx({ moves: [add('A'), add('B')], prices: { A: 1, B: 1 }, openSlots: 1 }),
      opts()
    );
    expect(plan.picks.map((p) => p.cutName)).toEqual([null, 'Filler A']);
  });

  it('counts a free owned copy as $0 and a copy committed elsewhere as bought', () => {
    const moves = [
      add('Mine', { ownership: 'owned' }),
      add('Elsewhere', { ownership: 'in-other-deck' }),
      add('Moved', { lane: 'decks', ownership: 'owned' }),
    ];
    const prices = { Mine: 10, Elsewhere: 10, Moved: 10 };
    const on = planUpgrades(ctx({ moves, prices }), opts());
    expect(on.picks.map((p) => p.cost)).toEqual([0, 10, 10]);
    expect(on.fromCollection).toBe(1);
    const off = planUpgrades(ctx({ moves, prices }), opts({ ownedFree: false }));
    expect(off.picks.map((p) => p.cost)).toEqual([10, 10, 10]);
  });

  it('never treats a card with no price as free', () => {
    const plan = planUpgrades(
      ctx({ moves: [add('Unknown'), add('Known')], prices: { Known: 2 } }),
      opts()
    );
    expect(names(plan)).toEqual(['Known']);
    expect(plan.unpriced.map((c) => c.name)).toEqual(['Unknown']);
  });

  it("falls back to the row's own acquire price", () => {
    const plan = planUpgrades(ctx({ moves: [add('Gap', { deltaPrice: 3 })] }), opts());
    expect(plan.picks[0].cost).toBe(3);
  });

  it('swaps land for land and nonland for nonland', () => {
    const plan = planUpgrades(
      ctx({
        moves: [add('Dual', { typeLine: 'Land' }), add('Spell', { typeLine: 'Instant' })],
        cuts: [cut('Weak spell', { typeLine: 'Sorcery' }), cut('Tapland', { typeLine: 'Land' })],
        prices: { Dual: 1, Spell: 1 },
      }),
      opts()
    );
    expect(plan.picks.map((p) => [p.change.name, p.cutName])).toEqual([
      ['Dual', 'Tapland'],
      ['Spell', 'Weak spell'],
    ]);
  });

  it('never cuts a role below its target unless the add fills that role', () => {
    const plan = planUpgrades(
      ctx({
        moves: [add('Threat'), add('Rampant Growth', { role: 'ramp' })],
        cuts: [cut('Only Removal', { role: 'removal' }), cut('Old Ramp', { role: 'ramp' })],
        roleCounts: { removal: 5, ramp: 10 },
        roleTargets: { removal: 5, ramp: 10 },
        prices: { Threat: 1, 'Rampant Growth': 1 },
      }),
      opts()
    );
    // Threat can't take the removal slot (at target) or the ramp slot (at target).
    expect(plan.picks.map((p) => [p.change.name, p.cutName])).toEqual([
      ['Rampant Growth', 'Old Ramp'],
    ]);
    expect(plan.rolesAfter).toEqual({ removal: 5, ramp: 10 });
  });

  it('fills a short role from outside it so the count actually rises', () => {
    const plan = planUpgrades(
      ctx({
        moves: [add('Swords', { role: 'removal' })],
        cuts: [cut('Weak Removal', { role: 'removal' }), cut('Vanilla')],
        roleCounts: { removal: 4 },
        roleTargets: { removal: 6 },
        prices: { Swords: 1 },
      }),
      opts()
    );
    expect(plan.picks[0].cutName).toBe('Vanilla');
    expect(plan.rolesAfter.removal).toBe(5);
  });

  it('keeps a pre-paired swap with its own cut, once', () => {
    const plan = planUpgrades(
      ctx({
        moves: [
          add('Breeding Pool', { type: 'swap', lane: 'lands', inName: 'Tapland' }),
          add('Hinterland Harbor', { type: 'swap', lane: 'lands', inName: 'Tapland' }),
        ],
        prices: { 'Breeding Pool': 5, 'Hinterland Harbor': 2 },
      }),
      opts()
    );
    expect(plan.picks.map((p) => [p.change.name, p.cutName])).toEqual([
      ['Breeding Pool', 'Tapland'],
    ]);
  });

  it('skips a move with nowhere to go', () => {
    const plan = planUpgrades(ctx({ moves: [add('A')], cuts: [], prices: { A: 1 } }), opts());
    expect(plan.picks).toEqual([]);
  });

  it('ignores cheaper-copy and audition lanes, other change types and duplicates', () => {
    const plan = planUpgrades(
      ctx({
        moves: [
          add('Cheaper', { type: 'swap', lane: 'budget', inName: 'Filler A' }),
          add('Audition', { lane: 'similar' }),
          cut('Some cut'),
          add('Twice'),
          add('Twice', { lane: 'upgrade' }),
        ],
        prices: { Cheaper: 1, Audition: 1, Twice: 1 },
      }),
      opts()
    );
    expect(names(plan)).toEqual(['Twice']);
  });

  it('skips unticked cards on both sides of a swap', () => {
    const plan = planUpgrades(
      ctx({
        moves: [add('A'), add('B'), add('C', { type: 'swap', lane: 'lands', inName: 'Filler D' })],
        prices: { A: 1, B: 1, C: 1 },
      }),
      opts({ excluded: new Set(['a', 'Filler D']) })
    );
    expect(names(plan)).toEqual(['B']);
  });

  describe('bracket', () => {
    const gc = (name: string) => add(name, { isGameChanger: true });

    it('holding leaves out raisers that would have fit, and only those', () => {
      const plan = planUpgrades(
        ctx({
          moves: [gc('Rift'), gc('Rhystic'), add('Fine')],
          prices: { Rift: 40, Rhystic: 70, Fine: 1 },
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Fine']);
      expect(plan.leftOutForBracket.map((c) => c.name)).toEqual(['Rift']);
    });

    it('moving up takes Game Changers first, up to the room left', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Fine'), gc('Rift'), gc('Muse'), gc('Tutor')],
          prices: { Fine: 1, Rift: 1, Muse: 1, Tutor: 1 },
          gameChangerRoom: 2,
          ceiling: 3,
        }),
        opts({ goal: 'up' })
      );
      expect(names(plan)).toEqual(['Rift', 'Muse', 'Fine']);
      expect(plan.leftOutForBracket.map((c) => c.name)).toEqual(['Tutor']);
    });

    it('drops the latest raiser until the re-estimate is back under the ceiling', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Fine'), add('Combo Piece', { lane: 'combos' }), add('Also Fine')],
          prices: { Fine: 1, 'Combo Piece': 1, 'Also Fine': 1 },
          raisesBracket: (c) => c.lane === 'combos',
          ceiling: 3,
          estimate: (adds) => (adds.includes('Combo Piece') ? 4 : 3),
        }),
        opts({ goal: 'up' })
      );
      expect(names(plan)).toEqual(['Fine', 'Also Fine']);
      expect(plan.estimateAfter).toBe(3);
      expect(plan.spent).toBe(2);
      expect(plan.leftOutForBracket.map((c) => c.name)).toEqual(['Combo Piece']);
    });

    it('drops the latest pick when no raiser explains the overshoot', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('A', { role: 'ramp' }), add('B')],
          cuts: [cut('Old Ramp', { role: 'ramp' }), cut('Filler')],
          prices: { A: 1, B: 1 },
          estimate: (a) => (a.length > 1 ? 3 : 2),
        }),
        opts()
      );
      expect(names(plan)).toEqual(['A']);
      expect(plan.estimateAfter).toBe(2);
    });

    it('any bracket skips the gate and the verify', () => {
      const plan = planUpgrades(
        ctx({ moves: [gc('Rift')], prices: { Rift: 40 }, estimate: () => 5 }),
        opts({ goal: 'any' })
      );
      expect(names(plan)).toEqual(['Rift']);
      expect(plan.estimateAfter).toBeNull();
    });
  });
});
