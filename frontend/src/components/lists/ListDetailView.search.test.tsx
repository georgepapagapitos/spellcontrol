// @vitest-environment happy-dom
/**
 * ListDetailView's "Search this list" box is dual-purpose: it filters the
 * owned-row table above (no keyboard nav of its own) AND, once the Scryfall
 * panel is opened for a 2+ character query, drives that panel's active row.
 * The arrows/Enter must stay inert for the first purpose and only wake up
 * for the second — see style-guide/overlays.md § Overlays and use-results-keys.ts.
 */
import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ListDef } from '@/types/index';

const h = vi.hoisted(() => ({
  moveActive: vi.fn(),
  addActive: vi.fn(),
  onActiveChange: undefined as ((card: unknown) => void) | undefined,
}));

const store: Record<string, unknown> = {
  removeListEntry: vi.fn(),
  updateListEntry: vi.fn(),
  addListEntry: vi.fn(),
  addListEntries: vi.fn(),
  cards: [],
  lists: [],
  binders: [],
  isRefreshingPrices: false,
  setMap: {},
};
vi.mock('@/store/collection', () => ({
  useCollectionStore: (selector?: (s: Record<string, unknown>) => unknown) =>
    selector ? selector(store) : store,
}));
vi.mock('@/store/toasts', () => ({
  useToastsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ push: vi.fn() }),
}));
vi.mock('@/lib/collection/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/components/card/CardPreview', () => ({ CardPreview: () => null }));
vi.mock('@/components/collection/CardEditDialog', () => ({ CardEditDialog: () => null }));
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

import { ListDetailView } from './ListDetailView';

const list = { id: 'l1', name: 'Probe list', entries: [] } as unknown as ListDef;

function stubViewport(tabletOrWider: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /min-width:\s*768px/.test(query) ? tabletOrWider : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

const renderList = () =>
  render(
    <MemoryRouter>
      <ListDetailView list={list} rows={[]} loading={false} />
    </MemoryRouter>
  );

beforeEach(() => {
  stubViewport(true);
});

afterEach(() => {
  vi.clearAllMocks();
  h.onActiveChange = undefined;
});

describe('ListDetailView Scryfall panel keyboard nav', () => {
  it('leaves the keys alone while the panel is closed, even with 2+ characters typed', () => {
    renderList();
    const input = screen.getByRole('textbox', { name: 'Search this list' });
    fireEvent.change(input, { target: { value: 'sol ring' } });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(h.moveActive).not.toHaveBeenCalled();
    expect(h.addActive).not.toHaveBeenCalled();
  });

  it('moves the active result and adds it once the panel is open and a row is active', async () => {
    renderList();
    const input = screen.getByRole('textbox', { name: 'Search this list' });
    fireEvent.change(input, { target: { value: 'sol ring' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search Scryfall for sol ring' }));
    await screen.findByTestId('results');

    act(() => h.onActiveChange?.({ id: 'a', name: 'Sol Ring' }));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(h.moveActive).toHaveBeenCalledWith(1);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(h.addActive).toHaveBeenCalledTimes(1);
  });
});
