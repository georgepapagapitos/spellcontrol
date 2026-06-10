// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';

// Render every virtual row so real rows are clickable in happy-dom (which has
// no layout, so the real virtualizer would render nothing).
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

// Stub the preview so the test can read the stack callbacks it was handed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let preview: any = null;
vi.mock('./CardPreview', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CardPreview: (props: any) => {
    preview = props;
    return <div data-testid="card-preview" />;
  },
}));

import { CardListTable } from './CardListTable';

let idSeq = 0;
function mk(o: Partial<EnrichedCard>): EnrichedCard {
  idSeq += 1;
  return {
    copyId: `copy-${idSeq}`,
    name: 'C',
    setCode: 'TST',
    setName: 'T',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: `sf-${idSeq}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 0,
    ...o,
  } as EnrichedCard;
}

// N copies of one printing (same scryfallId → rolls up into one row of qty N).
function copies(name: string, cmc: number, scryfallId: string, n: number): EnrichedCard[] {
  return Array.from({ length: n }, () => mk({ name, cmc, scryfallId }));
}

describe('CardListTable grouped preview (UX-001 regression)', () => {
  beforeEach(() => {
    preview = null;
    idSeq = 0;
    localStorage.setItem('mtg-collection-view-mode', 'list');
  });

  it('reads stack data from the grouped order, not the underlying sorted order', () => {
    // Name sort (the default) orders these [Aaa, Zzz]. Grouping by mana value
    // sections cmc-1 (Zzz) before cmc-5 (Aaa), so the grouped order is the
    // reverse: [Zzz, Aaa]. Distinct quantities make the row identity checkable.
    const cards = [...copies('Aaa', 5, 'sf-aaa', 3), ...copies('Zzz', 1, 'sf-zzz', 7)];
    render(
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group by' }));
    fireEvent.click(screen.getByRole('option', { name: 'Mana value' }));

    // First visible row is the cmc-1 section → Zzz (qty 7), which sits at
    // sorted-index 1 but grouped-index 0.
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[0]);

    expect(preview).not.toBeNull();
    expect(preview.index).toBe(0);
    expect(preview.cards[0].name).toBe('Zzz');
    // The bug indexed `sorted` in the stack callbacks, so getStackQty(0)
    // returned Aaa's qty (3) for the Zzz row. They must index displayRows.
    expect(preview.getStackQty(0)).toBe(7);
  });

  it('without grouping, stack data still matches the row (no regression)', () => {
    const cards = [...copies('Aaa', 5, 'sf-aaa', 3), ...copies('Zzz', 1, 'sf-zzz', 7)];
    render(
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} />
      </MemoryRouter>
    );

    // Default name-ascending order: row 0 = Aaa (qty 3).
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[0]);

    expect(preview.index).toBe(0);
    expect(preview.cards[0].name).toBe('Aaa');
    expect(preview.getStackQty(0)).toBe(3);
  });
});
