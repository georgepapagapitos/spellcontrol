import { describe, it, expect } from 'vitest';
import { planFill } from './fill-deck-plan';
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
});
