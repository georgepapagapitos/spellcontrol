import { describe, it, expect } from 'vitest';
import { Archetype } from '@/deck-builder/types';
import { applyArchetypeTypeFloor } from './curveUtils';

describe('applyArchetypeTypeFloor', () => {
  it('is a no-op for an archetype with no floor rule (e.g. GOODSTUFF)', () => {
    const targets = { creature: 40, instant: 10, sorcery: 10, artifact: 10, enchantment: 4 };
    const before = { ...targets };
    applyArchetypeTypeFloor(targets, Archetype.GOODSTUFF, 74);
    expect(targets).toEqual(before);
  });

  it('is a no-op when the archetype floor is already met', () => {
    const targets = { creature: 20, instant: 20, sorcery: 20, artifact: 4, enchantment: 4 };
    const before = { ...targets };
    // instant+sorcery = 40/68 = 59% >> the 30% spellslinger floor
    applyArchetypeTypeFloor(targets, Archetype.SPELLSLINGER, 68);
    expect(targets).toEqual(before);
  });

  it('pulls a bounded number of slots from creature into instant/sorcery to meet the spellslinger floor', () => {
    // 62 non-land slots, instant+sorcery = 10 (16%), well under the 30% floor (~19).
    const targets = { creature: 40, instant: 5, sorcery: 5, artifact: 6, enchantment: 6 };
    const totalBefore = Object.values(targets).reduce((a, b) => a + b, 0);
    applyArchetypeTypeFloor(targets, Archetype.SPELLSLINGER, 62);

    const totalAfter = Object.values(targets).reduce((a, b) => a + b, 0);
    expect(totalAfter).toBe(totalBefore); // total slot count is conserved
    expect(targets.instant + targets.sorcery).toBeGreaterThan(10);
    expect(targets.creature).toBeLessThan(40); // creature donated the slots
    expect(targets.artifact).toBe(6); // untouched donor-adjacent bucket
    expect(targets.enchantment).toBe(6);
  });

  it('bounds a single nudge to at most 15% of non-land slots, never overcorrecting in one pass', () => {
    // Deficit is huge (0 instant/sorcery against a 30% floor of ~19), but the
    // move should still cap around 15% of 62 (~9), not jump straight to 19.
    const targets = { creature: 56, instant: 0, sorcery: 0, artifact: 3, enchantment: 3 };
    applyArchetypeTypeFloor(targets, Archetype.SPELLSLINGER, 62);
    const moved = targets.instant + targets.sorcery;
    expect(moved).toBeLessThanOrEqual(Math.round(62 * 0.15) + 1); // +1 rounding slack
    expect(moved).toBeGreaterThan(0);
  });

  it('never drops the donor bucket below 2 cards', () => {
    const targets = { creature: 3, instant: 0, sorcery: 0, artifact: 1, enchantment: 1 };
    applyArchetypeTypeFloor(targets, Archetype.SPELLSLINGER, 5);
    expect(targets.creature).toBeGreaterThanOrEqual(2);
  });

  it('donates from artifact (not creature) when creature IS one of the floored types (tribal)', () => {
    const targets = { creature: 10, instant: 6, sorcery: 6, artifact: 20, enchantment: 6 };
    applyArchetypeTypeFloor(targets, Archetype.TRIBAL, 48); // 45% floor -> want ~22 creatures
    expect(targets.creature).toBeGreaterThan(10);
    expect(targets.artifact).toBeLessThan(20); // artifact donated, not instant/sorcery
  });

  it('supports the enchantress floor on the enchantment type alone', () => {
    const targets = { creature: 30, instant: 6, sorcery: 6, artifact: 6, enchantment: 2 };
    applyArchetypeTypeFloor(targets, Archetype.ENCHANTRESS, 50); // 15% floor -> want ~8 enchantments
    expect(targets.enchantment).toBeGreaterThan(2);
    expect(targets.creature).toBeLessThan(30);
  });
});
