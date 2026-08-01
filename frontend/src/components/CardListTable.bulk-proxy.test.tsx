// @vitest-environment happy-dom
/**
 * Bulk "Mark as proxy" (PR B of the proxy-cards feature): selecting rows in
 * the collection and toggling `proxy` on every selected copy in one action,
 * reusing the same replaceAllCards + Undo-toast mechanism as the single-card
 * edit path (CardListTable.edit-undo.test.tsx) rather than a new persistence
 * path. Also covers the price-total consequence: applyPrices force-zeros a
 * proxy's purchasePrice (lib/card-prices.ts) and that must land immediately,
 * not just on the next price refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import { setPrices, _resetForTests as resetPriceCache } from '../lib/card-prices';

// Render every virtual row so real rows are clickable in happy-dom (no layout).
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

function mk(o: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'copy-id',
    name: 'Card',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-id',
    purchasePrice: 5,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    cmc: 1,
    ...o,
  } as EnrichedCard;
}

function renderTable(cards: EnrichedCard[]) {
  useCollectionStore.setState({ cards });
  render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
}

function undoToast() {
  return useToastsStore.getState().toasts.find((t) => t.actionLabel === 'Undo');
}

function selectRow(name: string) {
  const [row] = screen.getAllByRole('button', { name: new RegExp(name, 'i') });
  fireEvent.click(row);
}

describe('CardListTable bulk "Mark as proxy"', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'list');
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({ cards: [] });
    resetPriceCache();
  });

  it('marks only the selected copies as proxy, zeros their price, and leaves others untouched', () => {
    const cards = [
      mk({ copyId: 'a', name: 'Alpha', scryfallId: 'sf-a', purchasePrice: 5 }),
      mk({ copyId: 'b', name: 'Beta', scryfallId: 'sf-b', purchasePrice: 7 }),
    ];
    renderTable(cards);

    fireEvent.click(screen.getByRole('button', { name: /select/i, hidden: false }));
    selectRow('alpha');

    const bulkRegion = screen.getByRole('region', { name: 'Bulk actions' });
    fireEvent.click(within(bulkRegion).getByRole('button', { name: 'Mark as proxy' }));

    const stored = useCollectionStore.getState().cards;
    const alpha = stored.find((c) => c.copyId === 'a')!;
    const beta = stored.find((c) => c.copyId === 'b')!;

    expect(alpha.proxy).toBe(true);
    expect(alpha.purchasePrice).toBe(0);
    expect(beta.proxy).toBeFalsy();
    expect(beta.purchasePrice).toBe(7);

    const t = undoToast();
    expect(t?.message).toBe('Marked 1 copy as proxy.');
  });

  it('Undo restores the prior proxy flag and price', () => {
    const cards = [mk({ copyId: 'a', name: 'Alpha', scryfallId: 'sf-a', purchasePrice: 5 })];
    renderTable(cards);

    fireEvent.click(screen.getByRole('button', { name: /select/i, hidden: false }));
    selectRow('alpha');
    const bulkRegion = screen.getByRole('region', { name: 'Bulk actions' });
    fireEvent.click(within(bulkRegion).getByRole('button', { name: 'Mark as proxy' }));

    expect(useCollectionStore.getState().cards[0].proxy).toBe(true);

    undoToast()!.onAction!();

    const restored = useCollectionStore.getState().cards[0];
    expect(restored.proxy).toBeFalsy();
    expect(restored.purchasePrice).toBe(5);
  });

  it('smart-toggles to unmark when every selected copy is already a proxy, restoring the cached price', () => {
    // Seed the device price cache (independent of the per-card purchasePrice
    // the mark direction zeroed) so unmark can prove it restores real value.
    setPrices({ 'sf-a': { usd: 12, pricedAt: Date.now() } });

    const cards = [
      mk({ copyId: 'a', name: 'Alpha', scryfallId: 'sf-a', purchasePrice: 0, proxy: true }),
    ];
    renderTable(cards);

    fireEvent.click(screen.getByRole('button', { name: /select/i, hidden: false }));
    selectRow('alpha');

    const bulkRegion = screen.getByRole('region', { name: 'Bulk actions' });
    // All selected are already proxy → button reads the unmark label.
    const toggleBtn = within(bulkRegion).getByRole('button', { name: 'Unmark proxy' });
    fireEvent.click(toggleBtn);

    const restored = useCollectionStore.getState().cards[0];
    expect(restored.proxy).toBe(false);
    expect(restored.purchasePrice).toBe(12);
    expect(undoToast()?.message).toBe('Unmarked 1 copy as proxy.');
  });

  it('disables the button at zero selection', () => {
    renderTable([mk({ copyId: 'a', name: 'Alpha' })]);
    fireEvent.click(screen.getByRole('button', { name: /select/i, hidden: false }));
    const bulkRegion = screen.getByRole('region', { name: 'Bulk actions' });
    const btn = within(bulkRegion).getByRole('button', {
      name: 'Mark as proxy',
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
