// @vitest-environment happy-dom
/**
 * The grid view's page viewer names each page's volume ("Vol 2 · Page 45")
 * once a binder outgrows its capacity, as the list view's does. The volumes
 * come from BinderPage's UNFILTERED pass as a prop: the view's own `binders`
 * can be the search-narrowed pass, which drops pages and would renumber them.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { BinderPage, BinderSection, EnrichedCard, MaterializedBinder, Volume } from '../types';

vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeTab: 'b',
      setActiveTab: vi.fn(),
      setEditingBinder: vi.fn(),
      updateBinder: vi.fn(),
      cards: [],
      replaceAllCards: vi.fn(),
    }),
}));
vi.mock('../store/toasts', () => ({
  useToastsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ push: vi.fn() }),
}));
vi.mock('../lib/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('./CardPreview', () => ({ CardPreview: () => null }));
vi.mock('./CardEditDialog', () => ({ CardEditDialog: () => null }));
vi.mock('./BinderDriftBanner', () => ({ BinderDriftBanner: () => null }));
vi.mock('./BinderSummaryBar', () => ({ BinderSummaryBar: () => null }));
const viewerProps = vi.fn();
vi.mock('./BinderPagePreview', () => ({
  BinderPagePreview: (props: { volumeLabels?: string[] }) => {
    viewerProps(props.volumeLabels);
    return null;
  },
}));

import { BinderView } from './BinderView';

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
  };
}

/** Four full 9-pocket pages in one section. */
function binder(): MaterializedBinder {
  const cards = Array.from({ length: 36 }, (_, i) => card(i));
  const pages: BinderPage[] = Array.from({ length: 4 }, (_, p) => ({
    pageNum: p + 1,
    slots: cards.slice(p * 9, p * 9 + 9),
  }));
  const section: BinderSection = { key: 'ALL', label: 'All cards', cards, pages };
  return {
    def: {
      id: 'b',
      name: 'Big',
      color: '#000',
      position: 0,
      filterGroups: [{ filter: {} }],
      sorts: [{ field: 'name', dir: 'asc' }],
      pocketSize: 9,
      doubleSided: false,
      fixedCapacity: 18,
      createdAt: 0,
      updatedAt: 0,
    },
    effectivePocketSize: 9,
    effectiveSorts: [{ field: 'name', dir: 'asc' }],
    displaySorts: [],
    sections: [section],
    totalCards: cards.length,
    totalPages: 4,
    totalValue: 0,
  };
}

const volume = (index: number, pageStart: number, pageEnd: number): Volume => ({
  index,
  pageStart,
  pageEnd,
  cardCount: 18,
  firstLabel: 'All cards',
  lastLabel: 'All cards',
});

function openFirstPage(volumes: Volume[] | null) {
  render(
    <MemoryRouter>
      <BinderView
        binders={[binder()]}
        controls={{ view: 'pages', onViewChange: () => {}, toggles: [] }}
        volumes={volumes}
      />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open page 1' }));
}

describe('grid view page viewer: volume labels', () => {
  beforeEach(() => viewerProps.mockClear());

  it('labels every page with its volume when the binder spans several', () => {
    openFirstPage([volume(1, 1, 2), volume(2, 3, 4)]);
    expect(viewerProps).toHaveBeenLastCalledWith(['Vol 1', 'Vol 1', 'Vol 2', 'Vol 2']);
  });

  it('passes no labels for a binder that fits one book', () => {
    openFirstPage([volume(1, 1, 4)]);
    expect(viewerProps).toHaveBeenLastCalledWith(undefined);
  });

  it('passes no labels when no volumes were supplied', () => {
    openFirstPage(null);
    expect(viewerProps).toHaveBeenLastCalledWith(undefined);
  });
});
