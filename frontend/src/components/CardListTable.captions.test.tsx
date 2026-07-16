// @vitest-environment happy-dom
/**
 * Grid "Details" captions — the per-line toggleable detail lines under each
 * card in grid view. Covers: default-on price + set lines, zero-price dash,
 * the sort-key echo (EDHREC rank), the Details popover (menuitemcheckbox per
 * line) + JSON persistence, migration from the legacy boolean key, and that
 * list view renders neither captions nor the Details control.
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

function valueCaptions(): string[] {
  return Array.from(
    document.querySelectorAll('.collection-grid-caption:not(.collection-grid-caption--set)')
  ).map((el) => el.textContent ?? '');
}

function setCaptions(): string[] {
  return Array.from(document.querySelectorAll('.collection-grid-caption--set')).map(
    (el) => el.textContent ?? ''
  );
}

function openDetailsMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
}

describe('grid Details captions', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'grid');
  });

  it('shows a USD price line and a set line under each card by default', () => {
    renderTable([
      mk({ name: 'Alpha', purchasePrice: 4.5, rarity: 'mythic' }),
      mk({ name: 'Beta', purchasePrice: 1234.5 }),
    ]);
    expect(valueCaptions()).toEqual(['$4.50', '$1,234.50']);
    expect(setCaptions()).toEqual(['TST · 1', 'TST · 2']);
    // The set line carries the rarity-tinted keyrune glyph (SetSymbol).
    const glyph = document.querySelector('.collection-grid-caption--set .set-symbol');
    expect(glyph?.className).toContain('ss-tst');
    expect(glyph?.className).toContain('set-symbol--mythic');
  });

  it('renders unknown (zero) prices as a dash', () => {
    renderTable([mk({ name: 'Alpha', purchasePrice: 0 })]);
    expect(valueCaptions()).toEqual(['—']);
  });

  it('folds both caption values into the tile aria-label, skipping dashes', () => {
    renderTable([
      mk({ name: 'Alpha', purchasePrice: 4.5 }),
      mk({ name: 'Beta', purchasePrice: 0 }),
    ]);
    expect(screen.getByRole('button', { name: 'Alpha, quantity 1, $4.50, TST · 1' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Beta, quantity 1, TST · 2' })).toBeDefined();
  });

  it('echoes the active sort key: EDHREC rank', () => {
    renderTable([
      mk({ name: 'Alpha', edhrecRank: 12034 }),
      mk({ name: 'Beta', edhrecRank: undefined }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: /EDHREC rank/ }));
    expect(valueCaptions()).toEqual(['#12,034', '—']);
  });

  it('Details menu toggles each line independently and persists as JSON', () => {
    renderTable([mk({ name: 'Alpha' })]);
    openDetailsMenu();

    const priceItem = screen.getByRole('menuitemcheckbox', { name: 'Price / sort value' });
    expect(priceItem.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(priceItem);
    expect(valueCaptions()).toEqual([]);
    expect(setCaptions()).toEqual(['TST · 1']);
    expect(JSON.parse(localStorage.getItem('mtg-collection-grid-caption-prefs')!)).toEqual({
      sortValue: false,
      set: true,
    });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Set & rarity' }));
    expect(setCaptions()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('mtg-collection-grid-caption-prefs')!)).toEqual({
      sortValue: false,
      set: false,
    });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Price / sort value' }));
    expect(valueCaptions()).toEqual(['$1.00']);
  });

  it('migrates the legacy boolean key: explicit off carries over as all-off', () => {
    localStorage.setItem('mtg-collection-grid-caption', '0');
    renderTable([mk({ name: 'Alpha' })]);
    expect(valueCaptions()).toEqual([]);
    expect(setCaptions()).toEqual([]);
  });

  it('migrates the legacy boolean key: on falls through to the defaults', () => {
    localStorage.setItem('mtg-collection-grid-caption', '1');
    renderTable([mk({ name: 'Alpha' })]);
    expect(valueCaptions()).toEqual(['$1.00']);
    expect(setCaptions()).toEqual(['TST · 1']);
  });

  it('the new prefs key wins over the legacy key', () => {
    localStorage.setItem('mtg-collection-grid-caption', '0');
    localStorage.setItem(
      'mtg-collection-grid-caption-prefs',
      JSON.stringify({ sortValue: true, set: false })
    );
    renderTable([mk({ name: 'Alpha' })]);
    expect(valueCaptions()).toEqual(['$1.00']);
    expect(setCaptions()).toEqual([]);
  });

  it('renders no captions and no Details control in list view', () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Alpha' })]);
    expect(valueCaptions()).toEqual([]);
    expect(setCaptions()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
  });
});
