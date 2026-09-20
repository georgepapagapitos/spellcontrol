// @vitest-environment happy-dom
/**
 * A list's compact view is the shared card table. Lists are the one rolled-out
 * surface whose sort state already speaks `SortField`, so its column headers
 * really do drive the sort — the same `pickSort` the SortMenu calls, one sort
 * state reached two ways.
 *
 * Binder and Notes are collection-copy facts a printing reference doesn't
 * carry, so they aren't in the preset. The inline target-price editor is the
 * column that exists only where the editor does: a want list.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnrichedCard, ListDef } from '../types';

const store: Record<string, unknown> = {
  removeListEntry: vi.fn(),
  updateListEntry: vi.fn(),
  addListEntry: vi.fn(),
  addListEntries: vi.fn(),
  cards: [],
  lists: [],
  binders: [],
  isRefreshingPrices: false,
  setMap: {},
};
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(store) : store,
}));
vi.mock('../store/toasts', () => ({
  useToastsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ push: vi.fn() }),
}));
vi.mock('../lib/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./CardPreview', () => ({ CardPreview: () => null }));
vi.mock('./CardEditDialog', () => ({ CardEditDialog: () => null }));
vi.mock('./InlineCardSearch', () => ({ InlineCardSearch: () => null }));

import { ListDetailView } from './ListDetailView';
import { LIST_TABLE_COLUMNS, LIST_TABLE_COLUMNS_WITH_TARGET } from './shared/CardTable';

const list = { id: 'l1', name: 'Probe list', entries: [] } as unknown as ListDef;

function card(name: string, price: number, set: string): EnrichedCard {
  return {
    copyId: `copy-${name}`,
    scryfallId: `sf-${name}`,
    name,
    setCode: set,
    setName: `${set} Set`,
    collectorNumber: '1',
    rarity: 'rare',
    purchasePrice: price,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 2,
    manaCost: '{1}{U}',
  } as EnrichedCard;
}

const rows = [
  { entry: { id: 'e1', quantity: 1 }, card: card('Brainstorm', 1, 'ICE') },
  { entry: { id: 'e2', quantity: 2 }, card: card('Ancestral', 9, 'ALP') },
] as never[];

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

const renderList = (dynamic = false) =>
  render(
    <MemoryRouter>
      <ListDetailView list={list} rows={rows} loading={false} dynamic={dynamic} />
    </MemoryRouter>
  );

const toCompact = () => fireEvent.click(screen.getByRole('button', { name: /^Compact/ }));

const names = () =>
  [...document.querySelectorAll('.collection-table-row .collection-list-name')].map(
    (el) => el.textContent
  );

describe('a list in compact view at tablet width and up', () => {
  beforeEach(() => {
    stubViewport(true);
    localStorage.clear();
  });

  it('renders the list column set, with the want list target price', () => {
    const { container } = renderList();
    toCompact();
    const cols = [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
      el.getAttribute('data-col')
    );
    expect(cols).toEqual([...LIST_TABLE_COLUMNS_WITH_TARGET]);
    // Collection-copy facts a printing reference doesn't carry.
    expect(cols).not.toContain('binder');
    expect(cols).not.toContain('notes');
  });

  it('drops the target column on a dynamic list, whose rows are owned copies', () => {
    const { container } = renderList(true);
    toCompact();
    const cols = [...container.querySelectorAll('.collection-table-head > [data-col]')].map((el) =>
      el.getAttribute('data-col')
    );
    expect(cols).toEqual([...LIST_TABLE_COLUMNS]);
    expect(cols).not.toContain('target');
  });

  it('sorts from the column headers, and reverses on a second click', () => {
    renderList();
    toCompact();
    expect(names()).toEqual(['Ancestral', 'Brainstorm']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Price' }));
    expect(names()).toEqual(['Ancestral', 'Brainstorm']); // price desc by default
    const active = screen.getByRole('button', { name: /^Sorted by Price/ });
    expect(active.getAttribute('data-active')).toBe('true');
    fireEvent.click(active);
    expect(names()).toEqual(['Brainstorm', 'Ancestral']);
  });

  it('leaves columns without a sort key as labels, not dead buttons', () => {
    renderList();
    toCompact();
    expect(screen.queryByRole('button', { name: /Sort by Lang/ })).toBeNull();
    expect(screen.getByText('Lang')).toBeTruthy();
  });
});

describe('a list in compact view below tablet width', () => {
  beforeEach(() => {
    stubViewport(false);
    localStorage.clear();
  });

  it('keeps the compact flow row', () => {
    const { container } = renderList();
    toCompact();
    expect(container.querySelector('.collection-table-head')).toBeNull();
    expect(container.querySelector('.collection-list.is-compact')).toBeTruthy();
  });
});
