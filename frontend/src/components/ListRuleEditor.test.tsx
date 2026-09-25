// @vitest-environment happy-dom
/**
 * The dynamic-list rule sheet, on the shared Modal / editor-sheet pattern
 * (board T139) — Escape now goes through the overlay stack Modal already
 * manages, instead of a bespoke `document` listener with no topmost check
 * (a nested popover's Escape used to also close the whole sheet). Also
 * covers the result footer (live count, Save) surviving the move.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EnrichedCard, ListDef } from '../types';
import { useCollectionStore } from '../store/collection';
import { Modal } from './Modal';
import { ListRuleEditor } from './ListRuleEditor';

vi.mock('../lib/scryfall-catalog', () => ({
  fetchTypeSuggestions: async () => [],
  fetchOracleSuggestions: async () => [],
}));
vi.mock('../lib/card-tags', async (importActual) => ({
  ...(await importActual<typeof import('../lib/card-tags')>()),
  useCardTagsReady: () => true,
  useCardTagsError: () => false,
  useCardsWithTags: (cards: EnrichedCard[]) => cards,
}));

function card(name: string): EnrichedCard {
  return {
    copyId: name,
    scryfallId: `s-${name}`,
    oracleId: `o-${name}`,
    name,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'common',
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Artifact',
  };
}

function makeList(overrides: Partial<ListDef> = {}): ListDef {
  return {
    id: 'l1',
    name: 'Wants',
    entries: [],
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useCollectionStore.setState({ cards: [], setListRule: vi.fn() });
});

/** Modal defers onClose until its exit animation ends — see Modal.test.tsx. */
const dismissEnd = () => {
  expect(document.querySelector('.modal-backdrop.is-closing')).not.toBeNull();
  fireEvent.animationEnd(screen.getByRole('dialog'), { animationName: 'modal-panel-out' });
};

describe('ListRuleEditor', () => {
  it('shows the live match count and a Save button in the footer', () => {
    useCollectionStore.setState({ cards: [card('Sol Ring')] });
    render(<ListRuleEditor list={makeList()} onClose={vi.fn()} />);
    expect(screen.getByText(/Matches/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeTruthy();
  });

  it('dismisses on Escape when it is the topmost overlay', () => {
    const onClose = vi.fn();
    render(<ListRuleEditor list={makeList()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the sheet open on Escape while a nested layer is topmost', () => {
    const onClose = vi.fn();
    render(<ListRuleEditor list={makeList()} onClose={onClose} />);
    // A real Modal stacked on top (e.g. a confirm dialog opened from a
    // condition row) — same overlay stack Modal.tsx already arbitrates
    // "stacked modals" with; this just proves ListRuleEditor delegates to
    // it instead of reintroducing its own listener.
    const nestedClose = vi.fn();
    const nested = render(
      <Modal onClose={nestedClose} label="Nested">
        <button type="button">nested action</button>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(nestedClose).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-backdrop.is-closing')).not.toBeNull();

    // The nested layer took that Escape and is mid-exit — let it finish,
    // then this sheet is topmost again and the next Escape reaches it.
    fireEvent.animationEnd(screen.getByRole('dialog', { name: 'Nested' }), {
      animationName: 'modal-panel-out',
    });
    expect(nestedClose).toHaveBeenCalledTimes(1);
    nested.unmount();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled(); // exit animation in flight
    dismissEnd();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves a non-empty rule and closes', () => {
    const setListRule = vi.fn();
    useCollectionStore.setState({ setListRule });
    const onClose = vi.fn();
    render(<ListRuleEditor list={makeList({ id: 'l2' })} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rarity' }));
    fireEvent.click(screen.getByRole('button', { name: /Add rarity/ }));
    fireEvent.click(screen.getByRole('option', { name: 'common' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(setListRule).toHaveBeenCalledWith('l2', [
      { filter: { rarities: { chips: [{ value: 'common', negate: false }], joiners: [] } } },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
