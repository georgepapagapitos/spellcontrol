// @vitest-environment happy-dom
/**
 * A binder's compact view is the same card table Collection uses, with one
 * difference: which binder a card is in is the one fact a binder page never
 * needs to state, so the Binder column gives its slot to the physical page
 * number. One header sits above every section, so the columns line up across
 * White / Blue / Multicolor rather than each block finding its own widths.
 *
 * Binder order is rule-driven (the SortPopover owns it), so the header labels
 * its columns without offering click-to-sort — a header you can click that
 * does nothing is worse than one you can't.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { BINDER_TABLE_COLUMNS } from './shared/CardTable';

function card(copyId: string, name: string, colorIdentity: string[]): EnrichedCard {
  return {
    copyId,
    name,
    setCode: 'SLD',
    setName: 'Secret Lair Drop',
    collectorNumber: '2418',
    rarity: 'rare',
    scryfallId: `sf-${copyId}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Basic Land',
    colorIdentity,
  } as EnrichedCard;
}

const mountain = card('m1', 'Mountain', ['R']);
const island = card('i1', 'Island', ['U']);

const binder = {
  def: {
    id: 'b',
    name: 'Lands',
    color: '#000',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'color', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    createdAt: 0,
    updatedAt: 0,
  },
  effectivePocketSize: 9,
  effectiveSorts: [{ field: 'color', dir: 'asc' }],
  displaySorts: [],
  // Two sections, which is the case the single shared header exists for.
  sections: [
    {
      key: 'R',
      label: 'Red',
      cards: [mountain],
      pages: [{ pageNum: 1, slots: [mountain, ...Array(8).fill(null)] }],
    },
    {
      key: 'U',
      label: 'Blue',
      cards: [island],
      pages: [{ pageNum: 2, slots: [island, ...Array(8).fill(null)] }],
    },
  ],
  totalCards: 2,
  totalPages: 2,
  totalValue: 2,
} as unknown as MaterializedBinder;

function stubViewport(tabletOrWider: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*768px/.test(query) ? tabletOrWider : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const renderBinder = (density: 'detail' | 'compact') =>
  render(
    <MemoryRouter>
      <BinderListView binder={binder} density={density} />
    </MemoryRouter>
  );

describe('a binder list at tablet width and up', () => {
  beforeEach(() => stubViewport(true));

  it('renders one header above every section, with the binder column set', () => {
    const { container } = renderBinder('compact');
    expect(container.querySelectorAll('.collection-table-head')).toHaveLength(1);
    const cols = [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
      el.getAttribute('data-col')
    );
    expect(cols).toEqual([...BINDER_TABLE_COLUMNS]);
    expect(cols).toContain('page');
    expect(cols).not.toContain('binder');

    // Every section's rows share the one header's template.
    const lists = container.querySelectorAll('.collection-list.is-table');
    expect(lists).toHaveLength(2);
    expect(container.querySelectorAll('.collection-table-row')).toHaveLength(2);
  });

  it('shows the physical page number in its own column', () => {
    const { container } = renderBinder('compact');
    const pages = [...container.querySelectorAll('.collection-table-row [data-col="page"]')].map(
      (el) => el.textContent
    );
    expect(pages).toEqual(['p.1', 'p.2']);
  });

  it('labels the columns without offering click-to-sort', () => {
    renderBinder('compact');
    expect(screen.getByRole('group', { name: 'Columns' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sort by/ })).toBeNull();
  });

  it('leaves the detail density as the thumbnail flow row', () => {
    const { container } = renderBinder('detail');
    expect(container.querySelector('.collection-table-head')).toBeNull();
    expect(container.querySelector('.collection-table-row')).toBeNull();
  });
});

describe('a binder list below tablet width', () => {
  beforeEach(() => stubViewport(false));

  it('keeps the compact flow row, where twelve columns would not fit', () => {
    const { container } = renderBinder('compact');
    expect(container.querySelector('.collection-table-head')).toBeNull();
    expect(container.querySelector('.collection-table-row')).toBeNull();
    expect(container.querySelector('.collection-list.is-compact')).toBeTruthy();
  });
});
