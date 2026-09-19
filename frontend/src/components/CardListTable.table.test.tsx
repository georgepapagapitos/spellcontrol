// @vitest-environment happy-dom
/**
 * Compact view at tablet width and up is a table: aligned cells under a
 * sticky header whose sortable columns drive the existing sort keys. Below
 * 768px the compact flow row stays and there is no header.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 32,
        size: 32,
      })),
    getTotalSize: () => count * 32,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

vi.mock('./CardPreview', () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from '../lib/shortcut-registry';

let idSeq = 0;
function mk(o: Partial<EnrichedCard> = {}): EnrichedCard {
  idSeq += 1;
  return {
    copyId: `copy-${idSeq}`,
    name: `Card ${idSeq}`,
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: `${idSeq}`,
    rarity: 'common',
    scryfallId: `sf-${idSeq}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 1,
    ...o,
  } as EnrichedCard;
}

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

function renderTable(c: EnrichedCard[]) {
  return render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable cards={c} binders={[]} />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
}

const rowNames = () =>
  [...document.querySelectorAll('.collection-table-row .collection-list-name')].map(
    (el) => el.textContent
  );

describe('compact view as a table (≥768px)', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'compact');
  });

  it('renders a header whose sortable columns drive the sort, and one cell per column', () => {
    stubViewport(true);
    renderTable([
      // The Set sort orders by set NAME (SORT_KEY_TO_FIELD), so the names differ too.
      mk({
        name: 'Alpha',
        setCode: 'ZZZ',
        setName: 'Zeta Set',
        notes: 'for trade',
        purchasePrice: 1.5,
      }),
      mk({ name: 'Beta', setCode: 'AAA', setName: 'Alpha Set' }),
    ]);
    expect(screen.getByRole('group', { name: 'Columns' })).toBeTruthy();
    // Labels only, no sort key: not a button.
    expect(screen.queryByRole('button', { name: /Sort by Notes/ })).toBeNull();
    expect(screen.getByText('Notes')).toBeTruthy();

    // Default sort is name A→Z.
    expect(rowNames()).toEqual(['Alpha', 'Beta']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Set' }));
    expect(rowNames()).toEqual(['Beta', 'Alpha']);
    // The active header shows its direction and reverses on a second click.
    const active = screen.getByRole('button', { name: /^Sorted by Set/ });
    expect(active.getAttribute('data-active')).toBe('true');
    fireEvent.click(active);
    expect(rowNames()).toEqual(['Alpha', 'Beta']);

    // Cells: notes text, unit price and line total both present.
    const alpha = document.querySelectorAll('.collection-table-row')[0];
    expect(alpha.querySelector('[data-col="notes"]')?.textContent).toBe('for trade');
    expect(alpha.querySelector('[data-col="price"]')?.textContent).toBe('$1.50');
    expect(alpha.querySelector('[data-col="total"]')?.textContent).toBe('$1.50');
  });

  it('keeps the compact flow row (no header) below 768px', () => {
    stubViewport(false);
    renderTable([mk({ name: 'Alpha' })]);
    expect(screen.queryByRole('group', { name: 'Columns' })).toBeNull();
    expect(document.querySelector('.collection-table-row')).toBeNull();
    expect(document.querySelector('.collection-list.is-compact')).toBeTruthy();
  });
});
