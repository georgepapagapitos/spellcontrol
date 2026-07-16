// @vitest-environment happy-dom
/**
 * Grid "Details" caption — the one-line detail under each card in grid view.
 * Covers: default-on price caption (USD-pinned, zero as dash), the sort-key
 * echo (EDHREC rank), the toolbar toggle + localStorage persistence, and
 * that list view never renders captions or the toggle.
 *
 * Uses the same virtualizer mock as the other CardListTable tests so all
 * virtual rows render in happy-dom (which has no layout).
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

function captions(): string[] {
  return Array.from(document.querySelectorAll('.collection-grid-caption')).map(
    (el) => el.textContent ?? ''
  );
}

describe('grid Details caption', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'grid');
  });

  it('shows a USD price caption under each card by default', () => {
    renderTable([
      mk({ name: 'Alpha', purchasePrice: 4.5 }),
      mk({ name: 'Beta', purchasePrice: 1234.5 }),
    ]);
    expect(captions()).toEqual(['$4.50', '$1,234.50']);
  });

  it('renders unknown (zero) prices as a dash', () => {
    renderTable([mk({ name: 'Alpha', purchasePrice: 0 })]);
    expect(captions()).toEqual(['—']);
  });

  it('folds the caption into the tile aria-label, skipping dashes', () => {
    renderTable([
      mk({ name: 'Alpha', purchasePrice: 4.5 }),
      mk({ name: 'Beta', purchasePrice: 0 }),
    ]);
    expect(screen.getByRole('button', { name: 'Alpha, quantity 1, $4.50' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Beta, quantity 1' })).toBeDefined();
  });

  it('echoes the active sort key: EDHREC rank', () => {
    renderTable([
      mk({ name: 'Alpha', edhrecRank: 12034 }),
      mk({ name: 'Beta', edhrecRank: undefined }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: /EDHREC rank/ }));
    expect(captions()).toEqual(['#12,034', '—']);
  });

  it('Details toggle hides captions and persists the choice', () => {
    renderTable([mk({ name: 'Alpha' })]);
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(toggle);
    expect(captions()).toEqual([]);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('mtg-collection-grid-caption')).toBe('0');

    fireEvent.click(toggle);
    expect(captions()).toEqual(['$1.00']);
    expect(localStorage.getItem('mtg-collection-grid-caption')).toBe('1');
  });

  it('starts hidden when the persisted preference is off', () => {
    localStorage.setItem('mtg-collection-grid-caption', '0');
    renderTable([mk({ name: 'Alpha' })]);
    expect(captions()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Details' }).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('renders no captions and no Details toggle in list view', () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Alpha' })]);
    expect(captions()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  });
});
