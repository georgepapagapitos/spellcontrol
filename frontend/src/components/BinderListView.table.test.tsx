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
 *
 * Cond, Lang and Notes are in the preset but only render when some copy on the
 * page actually deviates. A binder of 1,062 sleeved English near-mint cards was
 * spending three tracks — one of them two `fr` wide — to print "NM", "EN" and
 * nothing a thousand times, which is what made the table read as broken at
 * desktop width.
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
import { BINDER_TABLE_COLUMNS, type CardTableCol } from './shared/CardTable';

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

const renderBinder = (density: 'detail' | 'compact', b: MaterializedBinder = binder) =>
  render(
    <MemoryRouter>
      <BinderListView binder={b} density={density} />
    </MemoryRouter>
  );

const headerCols = (container: HTMLElement) =>
  [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
    el.getAttribute('data-col')
  );

/** The columns a binder only spends width on when some copy has something to put there. */
const OPTIONAL: CardTableCol[] = ['cond', 'lang', 'notes'];

/** The same two-section binder, with annotations applied to the red card. */
function binderWith(extra: Partial<EnrichedCard>): MaterializedBinder {
  const red = { ...mountain, ...extra } as EnrichedCard;
  return {
    ...binder,
    sections: [
      { ...binder.sections[0], cards: [red], pages: [{ pageNum: 1, slots: [red] }] },
      binder.sections[1],
    ],
  } as MaterializedBinder;
}

describe('a binder list at tablet width and up', () => {
  beforeEach(() => stubViewport(true));

  it('renders one header above every section, with the binder column set', () => {
    const { container } = renderBinder('compact');
    expect(container.querySelectorAll('.collection-table-head')).toHaveLength(1);
    const cols = headerCols(container);
    // The preset minus the annotation columns no copy in this binder uses.
    expect(cols).toEqual(BINDER_TABLE_COLUMNS.filter((c) => !OPTIONAL.includes(c)));
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

describe('the section divider is part of the table, not a bar above it', () => {
  beforeEach(() => stubViewport(true));

  it('draws the whole table as one framed slab', () => {
    const { container } = renderBinder('compact');
    const frame = container.querySelector('.collection-table');
    expect(frame?.classList.contains('is-framed')).toBe(true);
    // The page-grid section chrome (its own border, radius and margin) is what
    // split the table into three unconnected boxes. It has no business here.
    expect(container.querySelector('.binder-section')).toBeNull();
    expect(container.querySelector('.section-header-toggle')).toBeNull();
  });

  it('uses the same group bar as Collection, one per section', () => {
    const { container } = renderBinder('compact');
    const bars = container.querySelectorAll('.collection-list-section-header');
    expect(bars).toHaveLength(2);
    for (const bar of bars) expect(bar.classList.contains('binder-table-section')).toBe(true);
  });

  it('keeps the disclosure wired to the rows it hides', () => {
    const { container } = renderBinder('compact');
    const bar = container.querySelector('.binder-table-section') as HTMLElement;
    const panelId = bar.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = container.querySelector(`#${panelId}`) as HTMLElement;
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('aria-labelledby')).toBe(bar.id);
    expect(bar.getAttribute('aria-expanded')).toBe('true');
  });

  it('still says how many cards and how many are distinct', () => {
    const { container } = renderBinder('compact');
    const counts = [...container.querySelectorAll('.collection-list-section-count')].map(
      (el) => el.textContent
    );
    // One copy each, so the two numbers agree and only one is shown.
    expect(counts).toEqual(['1 card', '1 card']);
  });

  it('leaves the flow density on the page-grid section header', () => {
    const { container } = renderBinder('detail');
    expect(container.querySelector('.section-header-toggle')).toBeTruthy();
    expect(container.querySelector('.binder-table-section')).toBeNull();
    expect(container.querySelector('.collection-table')?.classList.contains('is-framed')).toBe(
      false
    );
  });
});

describe('the annotation columns a binder only earns by using them', () => {
  beforeEach(() => stubViewport(true));

  it('drops Cond, Lang and Notes when every copy is an unremarkable NM English one', () => {
    const { container } = renderBinder('compact');
    const cols = headerCols(container);
    for (const col of OPTIONAL) expect(cols).not.toContain(col);
    // And no row keeps a cell for a column the header no longer has.
    expect(container.querySelector('.collection-table-row [data-col="cond"]')).toBeNull();
  });

  it.each([
    ['condition', { condition: 'lp' } as Partial<EnrichedCard>, 'cond'],
    ['language', { language: 'ja' } as Partial<EnrichedCard>, 'lang'],
    ['notes', { notes: 'signed at GP' } as Partial<EnrichedCard>, 'notes'],
  ])('keeps the column as soon as one copy carries a %s', (_what, extra, col) => {
    const { container } = renderBinder('compact', binderWith(extra));
    expect(headerCols(container)).toContain(col);
  });

  it('is not fooled by the defaults the column exists to contrast with', () => {
    const { container } = renderBinder('compact', binderWith({ condition: 'nm', language: 'en' }));
    const cols = headerCols(container);
    expect(cols).not.toContain('cond');
    expect(cols).not.toContain('lang');
  });

  it('keeps every row aligned with the header it dropped columns from', () => {
    const { container } = renderBinder('compact', binderWith({ notes: 'signed at GP' }));
    const head = headerCols(container);
    const rows = [...container.querySelectorAll('.collection-table-row')].map((row) =>
      [...row.querySelectorAll(':scope > [data-col]')].map((el) => el.getAttribute('data-col'))
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual(head);
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
