// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OptimizeCard, OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { useOptimizePlan } from './useOptimizePlan';

function card(over: Partial<OptimizeCard> & { name: string }): OptimizeCard {
  return {
    reason: 'because',
    reasonCategory: 'low-inclusion',
    inclusion: 50,
    ...over,
  };
}

const swaps: OptimizeSwaps = {
  removals: [
    card({ name: 'Cut A', reasonCategory: 'low-synergy', inclusion: 10, price: '1.00' }),
    card({ name: 'Cut B', reasonCategory: 'low-synergy', inclusion: 20 }),
    card({ name: 'Cut C', reasonCategory: 'tapland', inclusion: 5, price: '2.50' }),
  ],
  additions: [
    card({ name: 'Add A', reasonCategory: 'fills:removal', inclusion: 60, price: '3.00' }),
    card({ name: 'Add B', reasonCategory: 'fills:removal', inclusion: 40 }),
  ],
};

describe('useOptimizePlan', () => {
  it('defaults to all checked', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    expect(result.current.checkedRemovalNames).toEqual(['Cut A', 'Cut B', 'Cut C']);
    expect(result.current.checkedAdditionNames).toEqual(['Add A', 'Add B']);
    expect(result.current.isRemovalChecked('Cut A')).toBe(true);
    expect(result.current.isAdditionChecked('Add B')).toBe(true);
  });

  it('toggles a single card', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    act(() => result.current.toggle('remove', 'Cut B'));
    expect(result.current.isRemovalChecked('Cut B')).toBe(false);
    expect(result.current.checkedRemovalNames).toEqual(['Cut A', 'Cut C']);
    act(() => result.current.toggle('remove', 'Cut B'));
    expect(result.current.isRemovalChecked('Cut B')).toBe(true);
  });

  it('tracks group tri-state', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    const lowSynergy = ['Cut A', 'Cut B'];
    expect(result.current.removalGroupState(lowSynergy)).toBe(true);

    act(() => result.current.toggle('remove', 'Cut A'));
    expect(result.current.removalGroupState(lowSynergy)).toBe('mixed');

    act(() => result.current.toggle('remove', 'Cut B'));
    expect(result.current.removalGroupState(lowSynergy)).toBe(false);
  });

  it('toggleGroup selects all then deselects all', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    const lowSynergy = ['Cut A', 'Cut B'];
    // Fully checked → deselect.
    act(() => result.current.toggleGroup('remove', lowSynergy));
    expect(result.current.removalGroupState(lowSynergy)).toBe(false);
    // Partial/none → select all.
    act(() => result.current.toggleGroup('remove', lowSynergy));
    expect(result.current.removalGroupState(lowSynergy)).toBe(true);
  });

  it('setAll checks/unchecks an entire side', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    act(() => result.current.setAll('add', false));
    expect(result.current.checkedAdditionNames).toEqual([]);
    act(() => result.current.setAll('add', true));
    expect(result.current.checkedAdditionNames).toEqual(['Add A', 'Add B']);
  });

  it('computes totals math (counts, projectedSize, scoreDelta)', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    const t = result.current.totals;
    expect(t.cutCount).toBe(3);
    expect(t.addCount).toBe(2);
    // 100 − 3 cuts + 2 adds = 99
    expect(t.projectedSize).toBe(99);
    // adds 60+40=100, cuts 10+20+5=35 → 65
    expect(t.scoreDelta).toBe(65);
  });

  it('recomputes totals after toggling', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    act(() => result.current.setAll('remove', false));
    const t = result.current.totals;
    expect(t.cutCount).toBe(0);
    expect(t.projectedSize).toBe(102); // 100 + 2 adds
    expect(t.scoreDelta).toBe(100); // only adds count
  });

  it('priceDelta sums only parseable prices', () => {
    const { result } = renderHook(() => useOptimizePlan(swaps, 100));
    // adds: 3.00 (Add A; Add B has none) → 3.00
    // cuts: 1.00 (Cut A) + 2.50 (Cut C) → 3.50
    expect(result.current.totals.priceDelta).toBeCloseTo(3.0 - 3.5, 5);
  });

  it('priceDelta is null when no checked card has a price', () => {
    const noPrice: OptimizeSwaps = {
      removals: [card({ name: 'X', price: undefined })],
      additions: [card({ name: 'Y', price: undefined })],
    };
    const { result } = renderHook(() => useOptimizePlan(noPrice, 50));
    expect(result.current.totals.priceDelta).toBeNull();
  });

  it('parses messy price strings and ignores garbage', () => {
    const messy: OptimizeSwaps = {
      removals: [card({ name: 'R', price: '$1.25' })],
      additions: [card({ name: 'A1', price: '4.00' }), card({ name: 'A2', price: 'n/a' })],
    };
    const { result } = renderHook(() => useOptimizePlan(messy, 50));
    expect(result.current.totals.priceDelta).toBeCloseTo(4.0 - 1.25, 5);
  });

  it('treats null inclusion as zero in scoreDelta', () => {
    const withNull: OptimizeSwaps = {
      removals: [card({ name: 'R', inclusion: null })],
      additions: [card({ name: 'A', inclusion: null })],
    };
    const { result } = renderHook(() => useOptimizePlan(withNull, 50));
    expect(result.current.totals.scoreDelta).toBe(0);
  });
});
