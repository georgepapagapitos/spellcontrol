// @vitest-environment happy-dom
/**
 * The list view collapses identical ADJACENT copies into one ×N row while the
 * binder stays physically materialized — so the row keeps the first copy's
 * page number and the section header still counts every copy.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import type { EnrichedCard, MaterializedBinder } from '../types';

vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      cards: [],
      replaceAllCards: vi.fn(),
      updateBinder: vi.fn(),
      isRefreshingPrices: false,
    }),
}));
vi.mock('../store/toasts', () => ({
  useToastsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ push: vi.fn() }),
}));
vi.mock('../lib/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('./CardPreview', () => ({ CardPreview: () => null }));
vi.mock('./CardEditDialog', () => ({ CardEditDialog: () => null }));
vi.mock('./BinderPagePreview', () => ({ BinderPagePreview: () => null }));
vi.mock('./CardRowMenu', () => ({ CardRowMenu: () => null }));
vi.mock('./Legend', () => ({ Legend: () => null }));
vi.mock('./SortPopover', () => ({ SortPopover: () => null }));

import { BinderListView } from './BinderListView';

function card(copyId: string, scryfallId: string, name: string): EnrichedCard {
  return {
    copyId,
    name,
    setCode: 'SLD',
    setName: 'Secret Lair Drop',
    collectorNumber: '2418',
    rarity: 'rare',
    scryfallId,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Basic Land — Mountain',
    colorIdentity: ['R'],
  };
}

const m1 = card('m1', 'mtn', 'Mountain');
const m2 = card('m2', 'mtn', 'Mountain');
const m3 = card('m3', 'mtn', 'Mountain');
const forest = card('f1', 'frst', 'Forest');

const binder: MaterializedBinder = {
  def: {
    id: 'b',
    name: 'Lands',
    color: '#000',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'name', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    createdAt: 0,
    updatedAt: 0,
  },
  effectivePocketSize: 9,
  effectiveSorts: [{ field: 'name', dir: 'asc' }],
  displaySorts: [],
  sections: [
    {
      key: 'ALL',
      label: 'All cards',
      cards: [forest, m1, m2, m3],
      pages: [{ pageNum: 1, slots: [forest, m1, m2, m3, null, null, null, null, null] }],
    },
  ],
  totalCards: 4,
  totalPages: 1,
  totalValue: 4,
};

describe('BinderListView collapses identical adjacent copies', () => {
  it('shows one ×3 row for three copies of a printing and counts every copy in the header', () => {
    render(
      <MemoryRouter>
        <BinderListView
          binder={binder}
          controls={{ view: 'list', onViewChange: () => {}, toggles: [] }}
        />
      </MemoryRouter>
    );
    expect(screen.getAllByText('Mountain')).toHaveLength(1);
    expect(screen.getByText('×3')).toBeTruthy();
    expect(screen.getByText(/4 cards/).textContent).toContain('2 unique');
  });
});
