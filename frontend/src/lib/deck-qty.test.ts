import { describe, it, expect } from 'vitest';
import { planQtyChange } from './deck-qty';
import type { DeckCard } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';

function slot(allocatedCopyId: string | null): DeckCard {
  return {
    slotId: `slot-${Math.random().toString(36).slice(2, 8)}`,
    card: { name: 'Sol Ring', id: 'sf-1' } as ScryfallCard,
    allocatedCopyId,
  };
}

describe('planQtyChange', () => {
  it('absolute target above current count adds the difference', () => {
    const plan = planQtyChange([slot(null)], 3);
    expect(plan).toEqual({ addCount: 2, remove: [] });
  });

  it('absolute target below current count removes the difference', () => {
    const current = [slot(null), slot('copy-1'), slot(null)];
    const plan = planQtyChange(current, 1);
    expect(plan.addCount).toBe(0);
    expect(plan.remove).toHaveLength(2);
  });

  it('relative delta adds/removes without reading the absolute count', () => {
    const current = [slot(null)];
    expect(planQtyChange(current, 1, { relative: true })).toEqual({ addCount: 1, remove: [] });
    expect(planQtyChange(current, -1, { relative: true }).remove).toHaveLength(1);
  });

  it('zero delta is a no-op', () => {
    expect(planQtyChange([slot(null)], 1)).toEqual({ addCount: 0, remove: [] });
    expect(planQtyChange([slot(null)], 0, { relative: true })).toEqual({
      addCount: 0,
      remove: [],
    });
  });

  it('caps an increment at maxCopies, never adding past it', () => {
    const current = [slot(null), slot(null)];
    expect(planQtyChange(current, 5, undefined, 3)).toEqual({ addCount: 1, remove: [] });
    expect(planQtyChange(current, 5, undefined, 2)).toEqual({ addCount: 0, remove: [] });
  });

  it('a relative increment is also capped at maxCopies', () => {
    const current = [slot(null), slot(null)];
    expect(planQtyChange(current, 10, { relative: true }, 3).addCount).toBe(1);
  });

  it('an uncapped zone (no maxCopies) never limits the increment', () => {
    const current = [slot(null)];
    expect(planQtyChange(current, 20, { relative: true }).addCount).toBe(20);
  });

  it('a decrement releases an unallocated slot before an allocated one', () => {
    const unalloc = slot(null);
    const alloc = slot('copy-1');
    const plan = planQtyChange([alloc, unalloc], -1, { relative: true });
    expect(plan.remove).toEqual([unalloc]);
  });

  it('decrementing past zero clamps at removing everything present', () => {
    const current = [slot(null), slot(null)];
    const plan = planQtyChange(current, -5, { relative: true });
    expect(plan.remove).toHaveLength(2);
  });
});
