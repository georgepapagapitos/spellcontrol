// @vitest-environment happy-dom
/**
 * E493: the rules editor's live preview column/strip and the binder ladder.
 * These render the real BinderEditor against the real collection store (same
 * pattern as BinderEditor.flow.test.tsx) so the preview is proven against the
 * REAL materialize pass, not a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { BinderDef, EnrichedCard } from '../types';
import { useCollectionStore } from '../store/collection';
import { BinderEditor } from './BinderEditor';

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

// The preview's own page grid — asserted on the data it's HANDED (pageNum,
// label, pocketSize), not on rendered card art.
vi.mock('./PageGrid', () => ({
  PageGrid: ({
    pageNum,
    pocketSize,
    label,
  }: {
    pageNum: number;
    pocketSize: number;
    label?: string;
  }) => (
    <div data-testid={`preview-page-${pageNum}`} data-pocket={pocketSize}>
      {label}
    </div>
  ),
}));

let lastViewerProps: Record<string, unknown> | null = null;
vi.mock('./BinderPagePreview', () => ({
  BinderPagePreview: (props: Record<string, unknown>) => {
    lastViewerProps = props;
    return <div data-testid="page-viewer" />;
  },
}));

function stubViewport(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*599px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function makeBinderDef(overrides: Partial<BinderDef> = {}): BinderDef {
  const now = Date.now();
  return {
    id: 'b1',
    name: 'Trade box',
    position: 0,
    filterGroups: [{ filter: {} }],
    sorts: [{ field: 'color', dir: 'asc' }],
    pocketSize: 9,
    doubleSided: false,
    fixedCapacity: null,
    color: '#888',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function card(copyId: string, colorIdentity: string[], rarity = 'common'): EnrichedCard {
  return {
    copyId,
    scryfallId: `s-${copyId}`,
    oracleId: `o-${copyId}`,
    name: `Card ${copyId}`,
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: copyId,
    rarity,
    colorIdentity,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    typeLine: 'Creature',
  } as EnrichedCard;
}

const RARES = {
  rarities: {
    chips: [
      { value: 'rare', negate: false },
      { value: 'mythic', negate: false },
    ],
    joiners: ['OR' as const],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  stubViewport(false);
  useCollectionStore.setState({
    editingBinder: null,
    editingBinderSeed: null,
    binders: [],
    cards: [],
    hydrating: false,
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(id: string) {
  render(<BinderEditor />);
  act(() => {
    useCollectionStore.setState({ editingBinder: id });
  });
}

describe('the editor previews the draft (E493)', () => {
  it('renders pages from a real materialize pass, with the section label', () => {
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }] });
    useCollectionStore.setState({
      binders: [existing],
      cards: [card('1', ['W']), card('2', ['U'])],
    });
    open(existing.id);

    const white = screen.getByTestId('preview-page-1');
    expect(white.dataset.pocket).toBe('9');
    expect(white.textContent).toContain('White');
  });

  it('updates once a page-layout change settles (debounced, not per keystroke)', () => {
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }] });
    useCollectionStore.setState({
      binders: [existing],
      cards: [card('1', ['W']), card('2', ['U'])],
    });
    open(existing.id);
    expect(screen.getByTestId('preview-page-1').dataset.pocket).toBe('9');
    act(() => {
      vi.advanceTimersByTime(250); // the debounce settles on the opened binder
    });

    fireEvent.click(screen.getByRole('button', { name: /Pages/ }));
    fireEvent.click(screen.getByRole('radio', { name: '4-pocket, Toploader pages' }));
    // Not yet — the heavy materialize pass waits for the debounce.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByTestId('preview-page-1').dataset.pocket).toBe('9');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('preview-page-1').dataset.pocket).toBe('4');
  });

  it('jumps the preview to a section when it is selected from the list', () => {
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }] });
    // 3 full White pages (27 cards) then 1 Blue page, so Blue's page (index 3)
    // sits in a LATER spread than the one shown on open (pages 0–1) — proving
    // the jump actually moves the preview, not just re-rendering the same spread.
    const white = Array.from({ length: 27 }, (_, i) => card(`w${i}`, ['W']));
    const blue = [card('u0', ['U'])];
    useCollectionStore.setState({
      binders: [existing],
      cards: [...white, ...blue],
    });
    open(existing.id);

    expect(screen.getByTestId('preview-page-1').textContent).toContain('White');
    fireEvent.click(screen.getByText(/Blue · 1/).closest('button')!);
    expect(screen.queryByTestId('preview-page-1')).toBeNull();
    expect(screen.getByTestId('preview-page-4').textContent).toContain('Blue');
  });

  it("opens on the binder's own layout, never the draft the closed editor last held", () => {
    // The editor is mounted while closed; its debounced draft still holds the
    // blank 9-pocket form when this 4-pocket binder opens.
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }], pocketSize: 4 });
    useCollectionStore.setState({ binders: [existing], cards: [card('1', ['W'])] });
    open(existing.id);
    expect(screen.getByTestId('preview-page-1').dataset.pocket).toBe('4');
  });

  it('shows capacity as "N binders of <capacity>" once a fixed capacity is set', () => {
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }], fixedCapacity: 1 });
    useCollectionStore.setState({
      binders: [existing],
      cards: [card('1', ['W']), card('2', ['U'])],
    });
    open(existing.id);
    // Two one-card sections on two pages; a 1-card binder holds one page.
    const column = screen.getByText('Preview').closest('.binder-editor-preview') as HTMLElement;
    expect(within(column).getByText('binders of 1')).toBeTruthy();
  });

  it('on a phone, shows the compact strip instead of the column, opening the real pages on tap', () => {
    stubViewport(true);
    const existing = makeBinderDef({ filterGroups: [{ filter: {} }] });
    useCollectionStore.setState({
      binders: [existing],
      cards: [card('1', ['W']), card('2', ['U'])],
    });
    open(existing.id);

    expect(screen.queryByText('Preview')).toBeNull(); // no desktop column heading
    const strip = screen.getByRole('button', { name: /preview pages/i });
    expect(lastViewerProps).toBeNull();
    fireEvent.click(strip);
    expect(screen.getByTestId('page-viewer')).toBeTruthy();
    expect((lastViewerProps?.pages as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('the binder ladder agrees with the footer (E493)', () => {
  it('the draft rung and the footer report the same landing count', () => {
    const catcher = makeBinderDef({ id: 'lair', name: 'Secret Lair', position: 0 });
    const editing = makeBinderDef({
      id: 'rares',
      name: 'Rares',
      position: 1,
      filterGroups: [{ filter: RARES }],
    });
    useCollectionStore.setState({
      binders: [catcher, editing],
      cards: [card('1', [], 'rare'), card('2', [], 'mythic'), card('3', [], 'common')],
    });
    open('rares');

    const landLine = screen.getByText(/lands? here/).closest('strong')?.textContent ?? '';
    const rows = screen.getAllByRole('listitem');
    const myRung = rows.find((r) => r.textContent?.includes('This binder'))!;
    // "0 cards land here" (Secret Lair, the catch-all above, takes the rare).
    expect(landLine).toBe('0 cards land here');
    expect(myRung.textContent).toContain('0');
  });

  it('"Move above" from the ladder previews the new position and applies on save', () => {
    const catcher = makeBinderDef({ id: 'lair', name: 'Secret Lair', position: 0 });
    const editing = makeBinderDef({
      id: 'rares',
      name: 'Rares',
      position: 1,
      filterGroups: [{ filter: RARES }],
    });
    const moveBinderAbove = vi.fn();
    useCollectionStore.setState({
      binders: [catcher, editing],
      cards: [card('1', [], 'rare'), card('2', [], 'mythic')],
      moveBinderAbove,
      updateBinder: vi.fn(),
    });
    open('rares');

    expect(screen.getByText(/of its matches went to Secret Lair, above/)).toBeTruthy();
    // One fact, one place (E493): the caught-by line IS the zero-landing
    // warning here — exactly one "Move above", not a duplicate amber box.
    const moveButtons = screen.getAllByRole('button', { name: 'Move above Secret Lair' });
    expect(moveButtons).toHaveLength(1);
    fireEvent.click(moveButtons[0]);

    const landLine = () => screen.getByText(/lands? here/).closest('strong')?.textContent ?? '';
    expect(landLine()).toBe('2 cards land here');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(moveBinderAbove).toHaveBeenCalledWith('rares', 'lair');
  });

  it('the caught-by line takes the amber warning treatment exactly when the binder lands zero', () => {
    const catcher = makeBinderDef({ id: 'lair', name: 'Secret Lair', position: 0 });
    const editing = makeBinderDef({
      id: 'rares',
      name: 'Rares',
      position: 1,
      filterGroups: [{ filter: RARES }],
    });
    useCollectionStore.setState({
      binders: [catcher, editing],
      cards: [card('1', [], 'rare'), card('2', [], 'mythic')],
    });
    open('rares');

    const caughtLine = screen.getByText(/of its matches went to Secret Lair, above/).closest('p')!;
    expect(caughtLine.className).toMatch(/is-warning/);
  });
});
