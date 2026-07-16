// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { useToastsStore } from '../store/toasts';
import type { PrintingSelection } from './CardEditDialog';

interface StubDialogProps {
  currentScryfallId: string;
  currentFinish: PrintingSelection['finish'];
  quantity?: number;
  onConfirm: (selection: PrintingSelection) => void;
  onCancel: () => void;
}

// Render every virtual row so real rows are clickable in happy-dom (which has
// no layout, so the real virtualizer would render nothing). Same stub as
// CardListTable.grouped-preview.test.tsx.
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

// CardEditDialog's own printing-picker UX (fetch, search, dirty-check) is
// covered by CardEditDialog.test.tsx. Here we're testing CardListTable's OWN
// wiring — does confirming an edit call replaceAllCards and offer a working
// Undo, and does it stay silent for a no-op — so the dialog is stubbed down
// to two buttons that hand back a controlled PrintingSelection.
vi.mock('./CardEditDialog', () => ({
  CardEditDialog: (props: StubDialogProps) => (
    <div data-testid="edit-dialog">
      <button
        type="button"
        onClick={() =>
          props.onConfirm({
            card: {
              id: props.currentScryfallId,
              set: 'tst',
              set_name: 'Test Set',
              collector_number: '1',
              rarity: 'common',
            } as PrintingSelection['card'],
            finish: props.currentFinish,
            quantity: props.quantity,
          })
        }
      >
        confirm no-op
      </button>
      <button
        type="button"
        onClick={() =>
          props.onConfirm({
            card: {
              id: props.currentScryfallId,
              set: 'tst',
              set_name: 'Test Set',
              collector_number: '1',
              rarity: 'common',
            } as PrintingSelection['card'],
            finish: props.currentFinish,
            quantity: (props.quantity ?? 0) + 1,
          })
        }
      >
        confirm qty+1
      </button>
      <button type="button" onClick={props.onCancel}>
        cancel edit
      </button>
    </div>
  ),
}));

import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from '../lib/shortcut-registry';

function mk(copyId: string): EnrichedCard {
  return {
    copyId,
    name: 'Sol Ring',
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: '1',
    rarity: 'common',
    scryfallId: 'sf-sol',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Artifact',
    cmc: 1,
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

describe('CardListTable card-edit confirm — Undo affordance (E130)', () => {
  beforeEach(() => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    useToastsStore.setState({ toasts: [] });
    useCollectionStore.setState({ cards: [] });
  });

  it('a quantity edit persists the change and offers a working Undo', async () => {
    const cards = [mk('a'), mk('b'), mk('c')];
    renderTable(cards);

    fireEvent.click(screen.getAllByLabelText('Card actions')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit card' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm qty+1' }));

    // Committed: one fresh copy added on top of the 3 originals.
    expect(useCollectionStore.getState().cards).toHaveLength(4);

    const t = undoToast();
    expect(t).toBeTruthy();
    expect(t?.message).toBe('Updated Sol Ring.');

    t!.onAction!();

    // Undo restores exactly the pre-edit copy set.
    expect(
      useCollectionStore
        .getState()
        .cards.map((c) => c.copyId)
        .sort()
    ).toEqual(['a', 'b', 'c']);
  });

  it('a no-op edit (nothing changed) commits nothing and shows no Undo toast', async () => {
    const cards = [mk('a'), mk('b'), mk('c')];
    renderTable(cards);

    fireEvent.click(screen.getAllByLabelText('Card actions')[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit card' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm no-op' }));

    expect(
      useCollectionStore
        .getState()
        .cards.map((c) => c.copyId)
        .sort()
    ).toEqual(['a', 'b', 'c']);
    expect(undoToast()).toBeUndefined();
  });
});
