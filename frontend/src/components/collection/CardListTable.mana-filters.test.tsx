// @vitest-environment happy-dom
/**
 * E1019: the collection page's filter state carries exact mana values, mana
 * cost symbols and the Within color mode end to end: set in the dialog,
 * committed by Show, applied to the list, listed in the page's chip row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '@/types/index';

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

vi.mock('@/components/card/CardPreview', () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from '@/components/app-shell/shortcut-registry';

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

const cards = () => [
  mk({ name: 'Bolt', cmc: 1, manaCost: '{R}', colorIdentity: ['R'], scryfallId: 'sf-bolt' }),
  mk({ name: 'Eldrazi', cmc: 9, manaCost: '{9}', colorIdentity: [], scryfallId: 'sf-eld' }),
  mk({
    name: 'Rakdos',
    cmc: 2,
    manaCost: '{B}{R}',
    colorIdentity: ['B', 'R'],
    scryfallId: 'sf-rak',
  }),
];

const dlg = () => screen.getByRole('dialog', { name: 'Collection filters' });
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
const show = () => fireEvent.click(within(dlg()).getByRole('button', { name: /^Show / }));

describe('collection filters: mana values, mana cost and Within', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.setItem('mtg-collection-view-mode', 'list');
  });

  it('narrows to MV 9 through the 7+ strip and lists it in the chip row', () => {
    renderTable(cards());
    openFilters();
    fireEvent.click(within(dlg()).getByRole('button', { name: '7+' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: '9' }));
    show();
    expect(screen.getByRole('button', { name: /eldrazi/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /bolt/i })).toBeNull();
    const chips = screen.getByRole('group', { name: 'Active filters' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Remove filter: Mana value 9' }));
    expect(screen.getByRole('button', { name: /bolt/i })).toBeDefined();
  });

  it('narrows by a printed mana symbol and lists it in the chip row', () => {
    renderTable(cards());
    openFilters();
    fireEvent.click(within(dlg()).getByRole('button', { name: /More filters/ }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Add black mana' }));
    show();
    expect(screen.getByRole('button', { name: /rakdos/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /bolt/i })).toBeNull();
    const chips = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chips).getByText('Cost B')).toBeDefined();
  });

  it('Within keeps cards that fit the colors, colorless included', () => {
    renderTable(cards());
    openFilters();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Red' }));
    fireEvent.click(within(dlg()).getByRole('radio', { name: 'Within these' }));
    show();
    expect(screen.getByRole('button', { name: /bolt/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /eldrazi/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /rakdos/i })).toBeNull();
    const chips = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chips).getByText('Color: within Red')).toBeDefined();
  });

  it('Clear all in the page chip row also clears mana values and mana cost', () => {
    renderTable(cards());
    openFilters();
    fireEvent.click(within(dlg()).getByRole('button', { name: '2' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: /More filters/ }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Add red mana' }));
    show();
    const chips = screen.getByRole('group', { name: 'Active filters' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
    expect(screen.getByRole('button', { name: /bolt/i })).toBeDefined();
  });
});
