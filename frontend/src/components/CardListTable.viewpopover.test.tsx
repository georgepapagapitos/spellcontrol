// @vitest-environment happy-dom
/**
 * Narrow-viewport (≤640px) toolbar consolidation — the display controls
 * (zoom, Details, layout toggle, symbol key) collapse into a single "View"
 * popover so the sticky controls row stays one line on phones. Covers: the
 * standalone controls disappear and the View popover exposes them, caption
 * toggles still work from inside the panel, the symbol-key sub-page with its
 * Back button, and that list view drops the grid-only sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';

// Render every virtual row in tests.
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

function renderTable(c: EnrichedCard[]) {
  return render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable cards={c} binders={[]} />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
}

function openViewPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  return screen.getByRole('dialog', { name: 'View options' });
}

describe('narrow-viewport View popover', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'grid');
    // Phone viewport: the component gates on matchMedia('(max-width: 640px)').
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: /max-width:\s*640px/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  it('collapses the display controls into one View popover', () => {
    renderTable([mk({ name: 'Alpha' })]);
    // The standalone controls are gone from the toolbar…
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Smaller cards' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Grid view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show symbol key' })).toBeNull();
    // …and all reappear inside the View panel.
    const panel = openViewPopover();
    expect(screen.getByRole('group', { name: 'Collection view mode' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Card size' })).toBeDefined();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Price / sort value' })).toBeDefined();
    expect(panel.textContent).toContain('Symbol key');
  });

  it('caption toggles keep working from inside the panel', () => {
    renderTable([mk({ name: 'Alpha' })]);
    expect(document.querySelectorAll('.collection-grid-caption--set')).toHaveLength(1);
    openViewPopover();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Set & rarity' }));
    expect(document.querySelectorAll('.collection-grid-caption--set')).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('mtg-collection-grid-caption-prefs')!)).toEqual({
      sortValue: true,
      set: false,
    });
  });

  it('opens the symbol key as a sub-page and Back returns to the controls', () => {
    renderTable([mk({ name: 'Alpha' })]);
    openViewPopover();
    fireEvent.click(screen.getByRole('button', { name: /Symbol key/ }));
    // Key content replaces the controls…
    expect(screen.getByText('Card types')).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Card size' })).toBeNull();
    // …and Back restores them.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('group', { name: 'Card size' })).toBeDefined();
  });

  it('list view drops the grid-only sections but keeps layout + key', () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Alpha' })]);
    const panel = openViewPopover();
    expect(screen.getByRole('group', { name: 'Collection view mode' })).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Card size' })).toBeNull();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Price / sort value' })).toBeNull();
    expect(panel.textContent).toContain('Symbol key');
  });
});
