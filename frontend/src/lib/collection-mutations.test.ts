import { describe, it, expect } from 'vitest';
import type { EnrichedCard } from '../types';
import { printingFinishKey, removeCopiesOfPrinting } from './collection-mutations';

function copy(over: Partial<EnrichedCard> & { copyId: string }): EnrichedCard {
  return {
    name: 'Sol Ring',
    scryfallId: 's1',
    finish: 'nonfoil',
    foil: false,
    ...over,
  } as EnrichedCard;
}

describe('printingFinishKey', () => {
  it('uses the explicit finish when present', () => {
    expect(printingFinishKey({ scryfallId: 's1', finish: 'etched', foil: true })).toBe('s1:etched');
  });

  it('falls back to foil flag when finish is absent (legacy data)', () => {
    // `finish` is typed required, but older collection data may lack it —
    // the fallback path exists for exactly that, so cast to exercise it.
    type Arg = Parameters<typeof printingFinishKey>[0];
    expect(printingFinishKey({ scryfallId: 's1', foil: true } as unknown as Arg)).toBe('s1:foil');
    expect(printingFinishKey({ scryfallId: 's1', foil: false } as unknown as Arg)).toBe(
      's1:nonfoil'
    );
  });
});

describe('removeCopiesOfPrinting', () => {
  const key = 's1:nonfoil';

  it('returns the original array untouched when nothing matches the key', () => {
    const cards = [copy({ copyId: 'a', scryfallId: 'other' })];
    const res = removeCopiesOfPrinting(cards, key, 1, new Set());
    expect(res.next).toBe(cards);
    expect(res.removed).toEqual([]);
  });

  it('removes nothing when count is zero or negative', () => {
    const cards = [copy({ copyId: 'a' }), copy({ copyId: 'b' })];
    expect(removeCopiesOfPrinting(cards, key, 0, new Set()).removed).toEqual([]);
    expect(removeCopiesOfPrinting(cards, key, -3, new Set()).removed).toEqual([]);
  });

  it('clamps count to the number of matching copies', () => {
    const cards = [copy({ copyId: 'a' }), copy({ copyId: 'b' })];
    const res = removeCopiesOfPrinting(cards, key, 99, new Set());
    expect(res.removed).toHaveLength(2);
    expect(res.next).toEqual([]);
  });

  it('drops unallocated copies before allocated ones', () => {
    const cards = [
      copy({ copyId: 'alloc1' }),
      copy({ copyId: 'free1' }),
      copy({ copyId: 'alloc2' }),
    ];
    const allocated = new Set(['alloc1', 'alloc2']);

    const one = removeCopiesOfPrinting(cards, key, 1, allocated);
    expect(one.removed.map((c) => c.copyId)).toEqual(['free1']);
    expect(one.next.map((c) => c.copyId)).toEqual(['alloc1', 'alloc2']);

    const two = removeCopiesOfPrinting(cards, key, 2, allocated);
    // Free copy first, then one of the allocated ones.
    expect(two.removed[0].copyId).toBe('free1');
    expect(allocated.has(two.removed[1].copyId)).toBe(true);
    expect(two.next).toHaveLength(1);
  });

  it('leaves non-matching copies in place', () => {
    const cards = [copy({ copyId: 'keep', scryfallId: 'other' }), copy({ copyId: 'gone' })];
    const res = removeCopiesOfPrinting(cards, key, 1, new Set());
    expect(res.removed.map((c) => c.copyId)).toEqual(['gone']);
    expect(res.next.map((c) => c.copyId)).toEqual(['keep']);
  });
});
