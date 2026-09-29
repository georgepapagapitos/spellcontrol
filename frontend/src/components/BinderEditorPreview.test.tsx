// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BinderPage, BinderSection, EnrichedCard, MaterializedBinder } from '../types';
import { BinderEditorPreview } from './BinderEditorPreview';

vi.mock('./PageGrid', () => ({
  PageGrid: ({ pageNum, label }: { pageNum: number; label?: string }) => (
    <div data-testid={`page-${pageNum}`}>{label}</div>
  ),
}));

function card(i: number): EnrichedCard {
  return {
    copyId: `c${i}`,
    name: `Card ${i}`,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: `${i}`,
    rarity: 'common',
    scryfallId: `s${i}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  } as EnrichedCard;
}

/** Two sections of 9-card pages: White (2 pages), Blue (1 page). */
function fakeBinder(): MaterializedBinder {
  const whiteCards = Array.from({ length: 18 }, (_, i) => card(i));
  const blueCards = Array.from({ length: 9 }, (_, i) => card(100 + i));
  const whitePages: BinderPage[] = [
    { pageNum: 1, slots: whiteCards.slice(0, 9) },
    { pageNum: 2, slots: whiteCards.slice(9, 18) },
  ];
  const bluePages: BinderPage[] = [{ pageNum: 3, slots: blueCards }];
  const white: BinderSection = { key: 'W', label: 'White', cards: whiteCards, pages: whitePages };
  const blue: BinderSection = { key: 'U', label: 'Blue', cards: blueCards, pages: bluePages };
  return {
    def: {
      id: 'b',
      name: 'Draft',
      color: '#000',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [{ field: 'color', dir: 'asc' }],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: null,
      createdAt: 0,
      updatedAt: 0,
    },
    effectivePocketSize: 9,
    effectiveSorts: [{ field: 'color', dir: 'asc' }],
    displaySorts: [],
    sections: [white, blue],
    totalCards: 27,
    totalPages: 3,
    totalValue: 0,
  };
}

describe('BinderEditorPreview', () => {
  it('renders a loading state while the collection hydrates', () => {
    render(<BinderEditorPreview binder={null} loading />);
    expect(screen.getByText(/loading your cards/i)).toBeTruthy();
  });

  it('renders an honest empty state when nothing lands here', () => {
    const empty: MaterializedBinder = {
      ...fakeBinder(),
      sections: [],
      totalCards: 0,
      totalPages: 0,
    };
    render(<BinderEditorPreview binder={empty} loading={false} />);
    expect(screen.getByText(/no cards match here/i)).toBeTruthy();
  });

  it('renders the first spread of pages, stats and the sections list', () => {
    render(<BinderEditorPreview binder={fakeBinder()} loading={false} />);
    expect(screen.getByTestId('page-1').textContent).toContain('White');
    expect(screen.getByTestId('page-2').textContent).toContain('White');
    expect(screen.getByText('27')).toBeTruthy(); // cards stat
    expect(screen.getByText('3')).toBeTruthy(); // pages stat
    expect(screen.getByText(/White · 18/)).toBeTruthy();
    expect(screen.getByText(/Blue · 9/)).toBeTruthy();
    expect(screen.getByText('p. 1')).toBeTruthy();
    expect(screen.getByText('p. 3')).toBeTruthy();
  });

  it('shows the binders-of-capacity stat only when a capacity is set', () => {
    const { rerender } = render(<BinderEditorPreview binder={fakeBinder()} loading={false} />);
    expect(screen.queryByText(/binders? of/)).toBeNull();

    const capped = fakeBinder();
    capped.def = { ...capped.def, fixedCapacity: 27 };
    rerender(<BinderEditorPreview binder={capped} loading={false} />);
    expect(screen.getByText('binder of 27')).toBeTruthy();
  });

  it('counts binders by pages, as the Pages answer does, not cards over capacity', () => {
    // 19 cards on 3 pages (White ends one card into its second page). A
    // 20-card binder holds 2 pages, so this needs 2 binders, though 19 < 20.
    const b = fakeBinder();
    const white = b.sections[0];
    white.cards = white.cards.slice(0, 10);
    white.pages = [
      { pageNum: 1, slots: white.cards.slice(0, 9) },
      { pageNum: 2, slots: [white.cards[9], ...Array<null>(8).fill(null)] },
    ];
    b.totalCards = 19;
    b.def = { ...b.def, fixedCapacity: 20 };
    render(<BinderEditorPreview binder={b} loading={false} />);
    expect(screen.getByText('binders of 20')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('jumps the preview to a section on click, and steps with prev/next', () => {
    render(<BinderEditorPreview binder={fakeBinder()} loading={false} />);
    // Starts on the first spread: pages 1 and 2.
    expect(screen.getByTestId('page-1')).toBeTruthy();
    expect(screen.getByTestId('page-2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /previous spread/i }));
    // Already at the first spread — stays put (button is disabled, but a
    // click is still a no-op either way).
    expect(screen.getByTestId('page-1')).toBeTruthy();

    fireEvent.click(screen.getByText(/Blue · 9/).closest('button')!);
    expect(screen.getByTestId('page-3')).toBeTruthy();
    expect(screen.queryByTestId('page-1')).toBeNull();
  });
});
