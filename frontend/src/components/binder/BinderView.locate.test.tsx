// @vitest-environment happy-dom
/**
 * A "where is my copy" link (`/collection/binders/<id>?copy=<copyId>`, from
 * the collection's copy list) opens the page viewer at that copy's page with
 * its pocket marked. Before it, the link opened the binder at the top and the
 * page and pocket were only text in the list.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { BinderPage, BinderSection, EnrichedCard, MaterializedBinder } from '@/types/index';

const store = vi.hoisted(() => ({ cards: [] as unknown[] }));
vi.mock('@/store/collection', () => ({
  useCollectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeTab: 'b',
      setActiveTab: vi.fn(),
      setEditingBinder: vi.fn(),
      updateBinder: vi.fn(),
      cards: store.cards,
      replaceAllCards: vi.fn(),
    }),
}));
vi.mock('@/store/toasts', () => ({
  useToastsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ push: vi.fn() }),
}));
vi.mock('@/lib/collection/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('@/components/card/CardPreview', () => ({ CardPreview: () => null }));
vi.mock('@/components/collection/CardEditDialog', () => ({ CardEditDialog: () => null }));
vi.mock('./BinderDriftBanner', () => ({ BinderDriftBanner: () => null }));
vi.mock('./BinderSummaryBar', () => ({ BinderSummaryBar: () => null }));
const viewer = vi.fn();
vi.mock('./BinderPagePreview', () => ({
  BinderPagePreview: (props: {
    startPageIndex: number;
    locatedCopyId?: string;
    onClose: () => void;
  }) => {
    viewer({ start: props.startPageIndex, located: props.locatedCopyId });
    return (
      <button type="button" onClick={props.onClose}>
        Close pages
      </button>
    );
  },
}));

import { BinderView } from './BinderView';

afterEach(() => {
  cleanup();
  viewer.mockClear();
  store.cards = [];
});

function card(i: number, scryfallId = `s${i}`): EnrichedCard {
  return {
    copyId: `c${i}`,
    name: `Card ${i}`,
    setCode: 'TST',
    setName: 'Test',
    collectorNumber: `${i}`,
    rarity: 'common',
    scryfallId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
  };
}

/** Three full 9-pocket pages in one section. */
function binder(): MaterializedBinder {
  const cards = Array.from({ length: 27 }, (_, i) => card(i));
  const pages: BinderPage[] = Array.from({ length: 3 }, (_, p) => ({
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
      fixedCapacity: null,
      createdAt: 0,
      updatedAt: 0,
    },
    effectivePocketSize: 9,
    effectiveSorts: [{ field: 'name', dir: 'asc' }],
    displaySorts: [],
    sections: [section],
    totalCards: cards.length,
    totalPages: 3,
    totalValue: 0,
  };
}

function renderLocate(locate: { binderId: string; copyId: string } | null) {
  const onLocated = vi.fn();
  const utils = render(
    <MemoryRouter>
      <BinderView
        binders={[binder()]}
        controls={{ view: 'pages', onViewChange: () => {}, toggles: [] }}
        locate={locate}
        onLocated={onLocated}
      />
    </MemoryRouter>
  );
  return { ...utils, onLocated };
}

describe('grid view: a link to one copy', () => {
  it("opens the page viewer at the copy's page with its pocket marked", () => {
    const { onLocated } = renderLocate({ binderId: 'b', copyId: 'c20' });
    expect(viewer).toHaveBeenLastCalledWith({ start: 2, located: 'c20' });
    expect(onLocated).toHaveBeenCalledTimes(1);
    expect(onLocated).toHaveBeenCalledWith(true);
  });

  it('marks a copy of the same printing when grouping filed another copy', () => {
    store.cards = [card(99, 's11')];
    renderLocate({ binderId: 'b', copyId: 'c99' });
    expect(viewer).toHaveBeenLastCalledWith({ start: 1, located: 'c11' });
  });

  it('reports a copy the binder does not hold, and opens nothing', () => {
    const { onLocated } = renderLocate({ binderId: 'b', copyId: 'gone' });
    expect(viewer).not.toHaveBeenCalled();
    expect(onLocated).toHaveBeenCalledWith(false);
  });

  it('waits while the view still shows another binder', () => {
    const { onLocated } = renderLocate({ binderId: 'other', copyId: 'c20' });
    expect(viewer).not.toHaveBeenCalled();
    expect(onLocated).not.toHaveBeenCalled();
  });

  it('clears the mark with the viewer, so the next open is a plain one', () => {
    const { getByRole, rerender } = renderLocate({ binderId: 'b', copyId: 'c20' });
    fireEvent.click(getByRole('button', { name: 'Close pages' }));
    // The page spends the link once it opens the copy's page.
    rerender(
      <MemoryRouter>
        <BinderView
          binders={[binder()]}
          controls={{ view: 'pages', onViewChange: () => {}, toggles: [] }}
          locate={null}
        />
      </MemoryRouter>
    );
    viewer.mockClear();
    fireEvent.click(getByRole('button', { name: 'Open page 1' }));
    expect(viewer).toHaveBeenLastCalledWith({ start: 0, located: undefined });
  });
});
