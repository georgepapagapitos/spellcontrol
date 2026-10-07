import { describe, it, expect } from 'vitest';
import { planFill } from './fill-deck-plan';
import type { PlanJudge } from './plan-move-judge';
import type { ScryfallCard } from '@/deck-builder/types';

const spell = (name: string) => ({ name, type_line: 'Creature — Goblin' }) as ScryfallCard;
const basic = (name = 'Mountain') => ({ name, type_line: 'Basic Land — Mountain' }) as ScryfallCard;
const land = (name: string) => ({ name, type_line: 'Land' }) as ScryfallCard;
const names = (cs: ScryfallCard[]) => cs.map((c) => c.name);
const times = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe('planFill', () => {
  it('adds exactly what the generated deck has beyond the current one', () => {
    const current = [spell('A'), spell('B'), basic(), basic()];
    const generated = [spell('A'), spell('B'), spell('C'), spell('D'), basic(), basic(), basic()];
    const plan = planFill(current, generated, 7, { C: 5, D: 9 });
    // Spells most relevant first, then lands; the two held Mountains count.
    expect(names(plan.additions)).toEqual(['D', 'C', 'Mountain']);
    expect(plan.stillOpen).toBe(0);
  });

  it('keeps extra basics the player already has, cutting generated basics instead', () => {
    // Player holds 5 Mountains; the generator only wanted 3 lands in total.
    const current = [spell('A'), ...times(5, () => basic())];
    const generated = [spell('A'), spell('B'), spell('C'), basic(), basic(), land('Castle')];
    const plan = planFill(current, generated, 8, { B: 2, C: 1 });
    expect(names(plan.additions)).toEqual(['B', 'C']);
    expect(plan.additions).toHaveLength(8 - current.length);
  });

  it("gives up the least relevant spell when the generator dropped one of the player's cards", () => {
    // 'Illegal Card' stays in the deck even though the generator left it out.
    const current = [spell('Illegal Card'), spell('A')];
    const generated = [spell('A'), spell('B'), spell('C'), spell('D')];
    const plan = planFill(current, generated, 4, { B: 3, C: 1, D: 2 });
    expect(names(plan.additions)).toEqual(['B', 'D']);
  });

  it('reports open slots the generator could not fill', () => {
    const plan = planFill([spell('A')], [spell('A'), spell('B')], 4);
    expect(names(plan.additions)).toEqual(['B']);
    expect(plan.stillOpen).toBe(2);
  });

  it('adds nothing to a deck that is already full', () => {
    expect(planFill([spell('A'), spell('B')], [spell('C')], 2).additions).toEqual([]);
  });
  // E540 S9: the whole-deck objective may decline a card, never leave a slot worse than a small loss.
  describe('with the objective judge', () => {
    type Flags = { reason?: string; hard?: boolean; premium?: boolean };
    const judgeOf = (
      lossy: Record<string, Flags>,
      seen: string[][] = [],
      until?: (name: string, prior: string[]) => boolean
    ): PlanJudge => ({
      verdict: () => ({ status: 'unscored' }),
      loss: (add, prior) => {
        const before = prior.map((p) => p.add);
        seen.push([add.name, ...before]);
        const f = lossy[add.name];
        if (!f || until?.(add.name, before)) return { loss: false };
        return {
          loss: true,
          reason: f.reason ?? 'scores worse',
          hard: f.hard === true,
          premium: f.premium === true,
        };
      },
    });
    // The generator gave 4 cards for 2 slots; the best 2 were B and Trap.
    const overflow = (judge?: PlanJudge) =>
      planFill(
        [spell('A')],
        [spell('A'), spell('B'), spell('Trap'), spell('D'), spell('E')],
        3,
        { B: 4, Trap: 3, D: 2, E: 1 },
        judge
      );

    it('seats the next-best card when the judge declines a soft loss', () => {
      const plan = overflow(judgeOf({ Trap: { reason: 'ramp would rise to 16' } }));
      expect(names(plan.additions)).toEqual(['B', 'D']);
      expect(plan.stillOpen).toBe(0);
      expect(plan.declined.map((d) => [d.card.name, d.reason])).toEqual([
        ['Trap', 'ramp would rise to 16'],
      ]);
    });

    it('keeps a soft loss rather than leave the slot empty when nothing can take it', () => {
      const plan = planFill(
        [spell('A')],
        [spell('A'), spell('B'), spell('Trap')],
        3,
        { B: 2, Trap: 1 },
        judgeOf({ Trap: {} })
      );
      expect(names(plan.additions)).toEqual(['B', 'Trap']);
      expect(plan.stillOpen).toBe(0);
      expect(plan.declined).toEqual([]);
    });

    it('never declines a premium card for a soft loss, a role past its cap', () => {
      // Birthing Pod, 34.7% of decks and a tutor: declined on a cardDraw cap before this.
      const plan = overflow(judgeOf({ Trap: { premium: true, reason: 'cardDraw past its cap' } }));
      expect(names(plan.additions)).toEqual(['B', 'Trap']);
      expect(plan.declined).toEqual([]);
    });

    it('declines a premium card for a hard rule break, and still seats the next-best', () => {
      const plan = overflow(
        judgeOf({ Trap: { premium: true, hard: true, reason: 'breaks identity' } })
      );
      expect(names(plan.additions)).toEqual(['B', 'D']);
      expect(plan.declined.map((d) => d.card.name)).toEqual(['Trap']);
    });

    it('reads a broken hard rule again once the rest are in, as an owned share the later cards restore', () => {
      const plan = planFill(
        [spell('A')],
        [spell('A'), spell('Unowned'), spell('Owned')],
        3,
        { Unowned: 2, Owned: 1 },
        judgeOf({ Unowned: { hard: true, reason: 'breaks owned-share' } }, [], (_n, prior) =>
          prior.includes('Owned')
        )
      );
      expect(names(plan.additions).sort()).toEqual(['Owned', 'Unowned']);
      expect(plan.declined).toEqual([]);
    });

    it('judges each card against the cards added before it', () => {
      const seen: string[][] = [];
      planFill(
        [spell('A')],
        [spell('A'), spell('B'), spell('C')],
        3,
        { B: 2, C: 1 },
        judgeOf({}, seen)
      );
      expect(seen).toEqual([['B'], ['C', 'B']]);
    });

    it('declines nothing without a judge', () => {
      const plan = planFill([spell('A')], [spell('A'), spell('Trap')], 2);
      expect(names(plan.additions)).toEqual(['Trap']);
      expect(plan.declined).toEqual([]);
    });
  });
});
