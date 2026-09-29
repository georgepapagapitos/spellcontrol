// @vitest-environment happy-dom
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ListDef } from '@/types/index';

const h = vi.hoisted(() => ({
  addListEntry: vi.fn(),
  moveActive: vi.fn(),
  addActive: vi.fn(),
  onActiveChange: undefined as ((card: unknown) => void) | undefined,
}));

vi.mock('@/lib/overlays/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

vi.mock('@/store/collection', () => ({
  useCollectionStore: (selector: (s: { addListEntry: typeof h.addListEntry }) => unknown) =>
    selector({ addListEntry: h.addListEntry }),
}));

// The keyboard-nav test below needs the ref handle and onActiveChange
// forwarded the same way the real component does; everything else about a
// live Scryfall search is out of scope for this suite (InlineCardSearch has
// its own).
vi.mock('@/components/search/InlineCardSearch', () => ({
  InlineCardSearch: forwardRef(function MockInlineCardSearch(
    props: { onActiveChange?: (card: unknown) => void },
    ref
  ) {
    useImperativeHandle(ref, () => ({ moveActive: h.moveActive, addActive: h.addActive }));
    useEffect(() => {
      h.onActiveChange = props.onActiveChange;
    }, [props.onActiveChange]);
    return <div data-testid="results" />;
  }),
}));

import { ListAddCardSheet } from './ListAddCardSheet';

function list(over: Partial<ListDef> = {}): ListDef {
  return {
    id: 'l1',
    name: 'Wishlist',
    entries: [],
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as ListDef;
}

afterEach(() => {
  vi.clearAllMocks();
  h.onActiveChange = undefined;
});

describe('ListAddCardSheet keyboard nav', () => {
  it('moves the active result on Arrow keys and adds it on Enter once a result has gone active', async () => {
    render(<ListAddCardSheet list={list()} onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Search Scryfall to add a card' });
    fireEvent.change(input, { target: { value: 'sol ring' } });
    await screen.findByTestId('results');
    act(() => h.onActiveChange?.({ id: 'a', name: 'Sol Ring' }));

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(h.moveActive).toHaveBeenCalledWith(1);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.addActive).toHaveBeenCalledTimes(1);
  });

  it('leaves the keys alone before any result has gone active', () => {
    render(<ListAddCardSheet list={list()} onClose={() => {}} />);
    const input = screen.getByRole('textbox', { name: 'Search Scryfall to add a card' });
    fireEvent.change(input, { target: { value: 'sol ring' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(h.moveActive).not.toHaveBeenCalled();
    expect(h.addActive).not.toHaveBeenCalled();
  });
});
