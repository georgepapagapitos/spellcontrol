// @vitest-environment happy-dom
/**
 * The dynamic-list rule sheet, on the editor-sheet pattern (board T139):
 * Escape now goes through the shared overlay stack instead of a bespoke
 * `document` listener with no topmost check — a nested popover's Escape used
 * to also close the whole sheet. Also covers the result footer (live count,
 * Save) surviving the move.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EnrichedCard, ListDef } from '../types';
import { useCollectionStore } from '../store/collection';
import { useOverlayLayer } from '../lib/overlay-layer';
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

/** Mounted on top of the sheet to occupy the topmost overlay-layer slot. */
function NestedLayer() {
  useOverlayLayer();
  return null;
}

beforeEach(() => {
  useCollectionStore.setState({ cards: [], setListRule: vi.fn() });
  // Desktop-width path in `dismiss()` closes immediately; force the phone
  // path (`beginClose`) so every test exercises the same animated exit.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

const dismissEnd = () => {
  const sheet = document.querySelector('.list-rule-editor-sheet') as HTMLElement;
  expect(sheet.className).toContain('is-closing');
  fireEvent.animationEnd(sheet, { animationName: 'binder-sheet-slide-out' });
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
    const nested = render(<NestedLayer />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.list-rule-editor-sheet')?.className).not.toContain(
      'is-closing'
    );

    // Once the nested layer is gone, this sheet is topmost again and the
    // same Escape now reaches it.
    nested.unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
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
