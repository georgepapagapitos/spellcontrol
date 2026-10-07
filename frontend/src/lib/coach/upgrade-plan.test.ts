import { describe, expect, it } from 'vitest';
import {
  isBasicFetcher,
  isBasicName,
  planUpgrades,
  type UpgradePlanContext,
  type UpgradePlanOptions,
} from './upgrade-plan';
import type { Change } from './deck-change';
import type { PlanJudge, PlanPick, PlanVerdict } from './plan-move-judge';

const add = (name: string, extra: Partial<Change> = {}): Change => ({
  id: `fill-gaps:${name}`,
  type: 'add',
  lane: 'fill-gaps',
  name,
  ownership: 'unowned',
  inclusion: 50,
  ...extra,
});
const cut = (name: string, extra: Partial<Change> = {}): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  inclusion: 0,
  ...extra,
});
const landSwap = (name: string, out: string, deltaScore = 20, extra: Partial<Change> = {}) =>
  add(name, { type: 'swap', lane: 'lands', inName: out, role: 'land', deltaScore, ...extra });

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
const leftOut = (plan: ReturnType<typeof planUpgrades>) =>
  plan.leftOut.map((l) => `${l.change.name}:${l.reason}`);

describe('planUpgrades', () => {
  describe('ranking', () => {
    it('takes the most valuable swaps first, not the Coach order', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Fine', { inclusion: 30 }), add('Staple', { inclusion: 80 })],
          cuts: [cut('Only Slot')],
          prices: { Fine: 1, Staple: 1 },
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Staple']);
    });

    it('lets a free owned sidegrade lose to a paid upgrade', () => {
      const plan = planUpgrades(
        ctx({
          moves: [
            add('Owned Sidegrade', { ownership: 'owned', inclusion: 25 }),
            add('Real Upgrade', { inclusion: 70 }),
          ],
          cuts: [cut('Weak', { inclusion: 20 }), cut('Also Weak', { inclusion: 20 })],
          prices: { 'Real Upgrade': 3 },
        }),
        opts()
      );
      // 25 over 20 is a +5 sidegrade: not proposed at all.
      expect(names(plan)).toEqual(['Real Upgrade']);
    });

    it('puts a strong cheap card ahead of a pricey modest one', () => {
      // The live Zimone check: a $27 Prismatic Vista with a fixing gain took
      // half of $50 ahead of staples under a dollar.
      const plan = planUpgrades(
        ctx({
          moves: [
            landSwap('Prismatic Vista', 'Temple of the False God', 40),
            add('Staple', { inclusion: 60, typeLine: 'Enchantment' }),
            add('Other Staple', { inclusion: 55, typeLine: 'Instant' }),
          ],
          prices: { 'Prismatic Vista': 27.35, Staple: 0.34, 'Other Staple': 0.3 },
        }),
        opts({ budget: 27 })
      );
      expect(names(plan)).toEqual(['Staple', 'Other Staple']);
      expect(plan.nextOverBudget?.change.name).toBe('Prismatic Vista');
    });

    it('lets ownership break a tie', () => {
      const plan = planUpgrades(
        ctx({
          moves: [
            add('Bought', { inclusion: 60 }),
            add('Owned', { ownership: 'owned', inclusion: 60 }),
          ],
          cuts: [cut('One Slot')],
          prices: { Bought: 1, Owned: 1 },
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Owned']);
    });

    it('ranks a structural Coach tier above polish at the same gain', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Polish'), add('Structural')],
          cuts: [cut('One Slot')],
          prices: { Polish: 1, Structural: 1 },
          tierOf: (c) => (c.name === 'Structural' ? 1 : 3),
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Structural']);
    });

    it('values a completed combo and a filled short role', () => {
      const plan = planUpgrades(
        ctx({
          moves: [
            add('Staple', { inclusion: 40 }),
            add('Combo Piece', { lane: 'combos', inclusion: undefined }),
            add('Ramp', { role: 'ramp', inclusion: 30 }),
          ],
          cuts: [cut('A'), cut('B')],
          roleCounts: { ramp: 8 },
          roleTargets: { ramp: 10 },
          prices: { Staple: 1, 'Combo Piece': 1, Ramp: 1 },
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Combo Piece', 'Ramp']);
    });
  });

  describe('money', () => {
    it('skips what does not fit and keeps spending', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Pricey', { inclusion: 90 }), add('Mid', { inclusion: 60 }), add('Cheap')],
          prices: { Pricey: 60, Mid: 30, Cheap: 15 },
        }),
        opts()
      );
      // Cheap first: the same kind of gain for less money.
      expect(names(plan)).toEqual(['Cheap', 'Mid']);
      expect(plan.spent).toBe(45);
      expect(plan.nextOverBudget).toEqual({
        change: expect.objectContaining({ name: 'Pricey' }),
        cost: 60,
      });
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
      expect(leftOut(plan)).toEqual(['Unknown:no-price']);
    });

    it("falls back to the row's own acquire price", () => {
      const plan = planUpgrades(ctx({ moves: [add('Gap', { deltaPrice: 3 })] }), opts());
      expect(plan.picks[0].cost).toBe(3);
    });
  });

  describe('slots', () => {
    it('fills empty slots before cutting anything', () => {
      const plan = planUpgrades(
        ctx({ moves: [add('A'), add('B')], prices: { A: 1, B: 1 }, openSlots: 1 }),
        opts()
      );
      expect(plan.picks.map((p) => p.cutName)).toEqual([null, 'Filler A']);
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
            landSwap('Breeding Pool', 'Tapland', 30),
            landSwap('Hinterland Harbor', 'Tapland'),
          ],
          cuts: [],
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

    it('skips unticked cards', () => {
      const plan = planUpgrades(
        ctx({ moves: [add('A'), add('B')], prices: { A: 1, B: 1 } }),
        opts({ excluded: new Set(['a']) })
      );
      expect(names(plan)).toEqual(['B']);
    });
  });

  describe('keeping a card', () => {
    it('never cuts a kept card and finds another slot', () => {
      const plan = planUpgrades(
        ctx({ moves: [add('A')], prices: { A: 1 } }),
        opts({ kept: new Set(['Filler A']) })
      );
      expect(plan.picks[0].cutName).toBe('Filler B');
    });

    it("moves a pre-paired swap off a kept card onto the pool's next land", () => {
      const plan = planUpgrades(
        ctx({
          moves: [landSwap('Breeding Pool', 'Tapland', 30)],
          cuts: [cut('Tapland', { typeLine: 'Land' }), cut('Other Tapland', { typeLine: 'Land' })],
          prices: { 'Breeding Pool': 5 },
        }),
        opts({ kept: new Set(['Tapland']) })
      );
      expect(plan.picks.map((p) => p.cutName)).toEqual(['Other Tapland']);
    });
  });

  describe('basic lands', () => {
    it('never lets a fetch land take a basic', () => {
      const plan = planUpgrades(
        ctx({
          moves: [landSwap('Escape Tunnel', 'Plains', 25, { ownership: 'owned' })],
          cuts: [cut('Plains', { typeLine: 'Basic Land — Plains' })],
          basics: 20,
          fetchers: 0,
        }),
        opts()
      );
      expect(plan.picks).toEqual([]);
    });

    it('keeps basics at or above the fetch lands that need them', () => {
      const plan = planUpgrades(
        ctx({
          moves: [
            landSwap('Breeding Pool', 'Forest', 30),
            landSwap('Hinterland Harbor', 'Island', 30),
          ],
          cuts: [],
          prices: { 'Breeding Pool': 5, 'Hinterland Harbor': 2 },
          basics: 3,
          fetchers: 2,
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Hinterland Harbor']);
    });

    it('knows the basics and the fetch lands', () => {
      expect(isBasicName('Snow-Covered Island')).toBe(true);
      expect(isBasicName('Wastes')).toBe(true);
      expect(isBasicName('Island Sanctuary')).toBe(false);
      expect(isBasicFetcher(add('Fabled Passage'))).toBe(true);
      expect(
        isBasicFetcher(
          add('New Fetch', {
            card: { oracle_text: 'Search your library for a basic land card.' } as never,
          })
        )
      ).toBe(true);
      // The sacrifice fetches name land types, not "basic" (the live
      // Misty Rainforest-for-an-Island miss).
      const fetchText = (text: string) =>
        isBasicFetcher(add('Some Land', { card: { oracle_text: text } as never }));
      expect(
        fetchText(
          'Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card.'
        )
      ).toBe(true);
      expect(fetchText('Search your library for a Plains, Island, or Swamp card.')).toBe(true);
      expect(fetchText('Search your library for a creature card.')).toBe(false);
      expect(isBasicFetcher(add('Breeding Pool'))).toBe(false);
    });
  });

  describe('bracket', () => {
    const gc = (name: string, extra: Partial<Change> = {}) =>
      add(name, { isGameChanger: true, ...extra });

    it('holding leaves out raisers that would have fit, and only those', () => {
      const plan = planUpgrades(
        ctx({
          moves: [gc('Rift'), gc('Rhystic'), add('Fine')],
          prices: { Rift: 40, Rhystic: 70, Fine: 1 },
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Fine']);
      expect(leftOut(plan)).toEqual(['Rift:bracket']);
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
      expect(leftOut(plan)).toEqual(['Tutor:game-changer-limit']);
    });

    it('drops the card that actually moves the Estimate, not the latest pick', () => {
      // The Blessed Wind case: the planner used to drop the latest picks and
      // blame the bracket. The culprit here sits first in the plan.
      const plan = planUpgrades(
        ctx({
          moves: [add('Culprit', { inclusion: 90 }), add('Blessed Wind'), add('Bladewing')],
          prices: { Culprit: 1, 'Blessed Wind': 1, Bladewing: 1 },
          raisesBracket: () => false,
          ceiling: 3,
          estimate: (adds) => (adds.includes('Culprit') ? 4 : 3),
        }),
        opts({ goal: 'up' })
      );
      expect(names(plan)).toEqual(['Blessed Wind', 'Bladewing']);
      expect(leftOut(plan)).toEqual(['Culprit:power']);
      expect(plan.estimateAfter).toBe(3);
    });

    it('names a known raiser as the bracket reason when it is the culprit', () => {
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
      expect(plan.spent).toBe(2);
      expect(leftOut(plan)).toEqual(['Combo Piece:bracket']);
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
  // E540 S9: the whole-deck objective's judge decides what the plan may offer.
  describe('with the objective judge', () => {
    const refuse = (reason = 'scores worse'): PlanVerdict => ({
      status: 'refused',
      delta: -1,
      reason,
    });
    const ok: PlanVerdict = { status: 'ok', delta: 1 };
    const judgeOf = (
      f: (add: string, cutName: string | null, prior: readonly PlanPick[]) => PlanVerdict
    ): PlanJudge => ({
      verdict: (a, c, prior) => f(a.name, c, prior),
    });

    it('does not offer a swap the objective judges a loss', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Trap', { inclusion: 80 }), add('Real Upgrade', { inclusion: 70 })],
          cuts: [cut('Weak A'), cut('Weak B')],
          prices: { Trap: 1, 'Real Upgrade': 1 },
          judge: judgeOf((a) => (a === 'Trap' ? refuse() : ok)),
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Real Upgrade']);
      expect(plan.notUpgrades).toBe(1);
    });

    it('moves on to the next weakest card when the judge holds the first cut', () => {
      // The weakest card by play-rate is a protected tutor of this commander.
      const plan = planUpgrades(
        ctx({
          moves: [add('Upgrade', { inclusion: 70 })],
          cuts: [cut('Protected Tutor'), cut('Spare')],
          prices: { Upgrade: 1 },
          judge: judgeOf((_a, c) => (c === 'Protected Tutor' ? refuse('a tutor') : ok)),
        }),
        opts()
      );
      expect(plan.picks.map((p) => [p.change.name, p.cutName])).toEqual([['Upgrade', 'Spare']]);
    });

    it('re-slots a pre-paired swap whose cut the judge holds', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Upgrade', { type: 'swap', inName: 'Protected Combo Piece', inclusion: 70 })],
          cuts: [cut('Protected Combo Piece'), cut('Spare')],
          prices: { Upgrade: 1 },
          judge: judgeOf((_a, c) => (c === 'Protected Combo Piece' ? refuse() : ok)),
        }),
        opts()
      );
      expect(plan.picks.map((p) => p.cutName)).toEqual(['Spare']);
    });

    it('judges each pick against the picks before it', () => {
      const seen: string[][] = [];
      planUpgrades(
        ctx({
          moves: [add('First', { inclusion: 90 }), add('Second', { inclusion: 80 })],
          prices: { First: 1, Second: 1 },
          judge: judgeOf((a, _c, prior) => {
            seen.push([a, ...prior.map((p) => p.add)]);
            return ok;
          }),
        }),
        opts()
      );
      expect(seen).toContainEqual(['First']);
      expect(seen).toContainEqual(['Second', 'First']);
    });

    it('judges an add into an open slot with no cut', () => {
      const asked: (string | null)[] = [];
      const plan = planUpgrades(
        ctx({
          moves: [add('Filler', { inclusion: 70 })],
          openSlots: 1,
          prices: { Filler: 1 },
          judge: judgeOf((_a, c) => {
            asked.push(c);
            return refuse();
          }),
        }),
        opts()
      );
      expect(asked).toEqual([null]);
      expect(plan.picks).toEqual([]);
      expect(plan.notUpgrades).toBe(1);
    });

    it('keeps a card the judge could not score, on the plan own rules', () => {
      const plan = planUpgrades(
        ctx({
          moves: [add('Unknown', { inclusion: 70 })],
          prices: { Unknown: 1 },
          judge: judgeOf(() => ({ status: 'unscored' })),
        }),
        opts()
      );
      expect(names(plan)).toEqual(['Unknown']);
      expect(plan.notUpgrades).toBe(0);
    });

    it('runs unchanged without a judge', () => {
      const plan = planUpgrades(
        ctx({ moves: [add('Trap', { inclusion: 80 })], prices: { Trap: 1 } }),
        opts()
      );
      expect(names(plan)).toEqual(['Trap']);
      expect(plan.notUpgrades).toBe(0);
    });
  });
});
