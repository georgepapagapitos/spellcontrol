// @vitest-environment happy-dom
/**
 * Bulk delete from the collection's selection mode. The toast it raises has to
 * describe what was actually removed: the per-row and RemoveCopiesDialog paths
 * remove copies of ONE printing and name it, but a bulk selection spans many,
 * and reporting "Removed 500 copies of Finch Formation" for a mixed batch is
 * simply false — which is what a user saw while deleting their collection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';

vi.mock('../lib/local-cards', async (importActual) => ({
  ...(await importActual<typeof import('../lib/local-cards')>()),
  saveCollection: async () => {},
}));

// Auto-accept the delete confirmation; the dialog itself is not under test.
vi.mock('../lib/use-confirm', () => ({
  useConfirm: () => ({ confirm: async () => true, dialog: null }),
}));

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

async function selectAllAndDelete() {
  fireEvent.click(screen.getByRole('button', { name: /select/i, hidden: false }));
  const bulkRegion = screen.getByRole('region', { name: 'Bulk actions' });
  fireEvent.click(within(bulkRegion).getByRole('button', { name: /select all/i }));
  fireEvent.click(within(bulkRegion).getByRole('button', { name: /delete selected/i }));
  // applyRemoval runs after the awaited confirm resolves.
  await vi.waitFor(() => expect(undoToast()).toBeTruthy());
}

describe('CardListTable bulk delete', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('mtg-collection-view-mode', 'list');
    localStorage.setItem('mtg-collection-group-printings', 'false');
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({ cards: [] });
  });

  it('counts the cards instead of naming one of them when the batch spans printings', async () => {
    renderTable([
      mk({ copyId: 'a', name: 'Finch Formation', scryfallId: 'sf-a' }),
      mk({ copyId: 'b', name: 'Lightning Bolt', scryfallId: 'sf-b' }),
      mk({ copyId: 'c', name: 'Counterspell', scryfallId: 'sf-c' }),
    ]);
    await selectAllAndDelete();

    expect(undoToast()!.message).toBe('Removed 3 cards');
    expect(useCollectionStore.getState().cards).toEqual([]);
  });

  it('still names the card when every removed copy is the same one', async () => {
    renderTable([
      mk({ copyId: 'a', name: 'Finch Formation', scryfallId: 'sf-a' }),
      mk({ copyId: 'b', name: 'Finch Formation', scryfallId: 'sf-a' }),
    ]);
    await selectAllAndDelete();

    expect(undoToast()!.message).toBe('Removed 2 copies of Finch Formation');
  });

  it('Undo puts the removed copies back', async () => {
    renderTable([
      mk({ copyId: 'a', name: 'Finch Formation', scryfallId: 'sf-a' }),
      mk({ copyId: 'b', name: 'Lightning Bolt', scryfallId: 'sf-b' }),
    ]);
    await selectAllAndDelete();
    expect(useCollectionStore.getState().cards).toEqual([]);

    undoToast()!.onAction!();
    expect(
      useCollectionStore
        .getState()
        .cards.map((c) => c.copyId)
        .sort()
    ).toEqual(['a', 'b']);
  });
});
