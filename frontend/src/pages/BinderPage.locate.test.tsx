// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaterializedBinder } from '@/types/index';

/**
 * A "where is my copy" link (`?copy=`) lands on the page grid, the one view
 * with pockets, without changing the view the binder remembers. The page
 * tells a copy on a shown page from one a search hides and one no longer in
 * the binder. BinderView's half (finding the page, marking the pocket) is
 * BinderView.locate.test.tsx.
 */

const sync = vi.hoisted(() => ({ state: 'ready', listeners: new Set<() => void>() }));
vi.mock('@/lib/sync', () => ({
  getSyncState: () => sync.state,
  hasSyncError: () => false,
  onSyncedChange: (fn: () => void) => {
    sync.listeners.add(fn);
    return () => sync.listeners.delete(fn);
  },
}));
vi.mock('@/lib/collection/allocations', () => ({ useAllocations: () => new Map() }));

const bolt = {
  copyId: 'c1',
  name: 'Lightning Bolt',
  scryfallId: 's1',
  setCode: 'm11',
  collectorNumber: '149',
  foil: false,
};
const binderWith = (slots: unknown[]) =>
  ({
    def: {
      id: 'b1',
      name: 'Red Spells',
      color: '#a8452a',
      filterGroups: [],
      sorts: [],
      pocketSize: 9,
      fixedCapacity: null,
    },
    sections: [{ key: 'ALL', label: 'All cards', cards: slots, pages: [{ pageNum: 1, slots }] }],
    totalCards: slots.length,
    totalPages: 1,
    effectivePocketSize: 9,
  }) as unknown as MaterializedBinder;
// The binder holds the Bolt by a tag rule, so it's empty until the tag data
// loads (`layout.settled`), until the Bolt itself has arrived, and under a
// search for anything else.
const layout = vi.hoisted(() => ({ settled: true }));
vi.mock('@/lib/binder/use-binder-layout-inputs', async () => {
  const { useCollectionStore } = await import('../store/collection');
  return {
    useBinderLayoutInputs: () => ({
      cards: useCollectionStore((s) => s.cards),
      binders: useCollectionStore((s) => s.binders),
      allocatedCopyIds: new Set(),
      setMap: undefined,
      settled: layout.settled,
    }),
  };
});
vi.mock('@/lib/binder/materialize', () => ({
  materializeBinders: (cards: unknown[], _defs: unknown, opts: { search: string }) => ({
    binders: [
      binderWith(
        !layout.settled ||
          !cards.some((c) => (c as { copyId: string }).copyId === 'c1') ||
          (opts.search && !/bolt/i.test(opts.search))
          ? []
          : [bolt]
      ),
    ],
  }),
}));
const toastShow = vi.hoisted(() => vi.fn());
vi.mock('../store/toasts', () => ({ toast: { show: toastShow } }));

type ViewProps = { locate: unknown; onLocated?: (found: boolean) => void };
const viewProps = vi.hoisted(() => ({ last: null as null | ViewProps }));
vi.mock('@/components/binder/BinderView', () => ({
  BinderView: (props: ViewProps) => {
    viewProps.last = props;
    return <div>PAGE GRID</div>;
  },
}));
// The banner baselines the binder back into the store; the stub binder here
// would loop it.
vi.mock('@/components/binder/BinderDriftBanner', () => ({ BinderDriftBanner: () => null }));
vi.mock('@/components/binder/BinderListView', () => ({
  BinderListView: () => <div>LIST VIEW</div>,
}));

import { BinderPage } from './BinderPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/collection/binders/:id"
          element={
            <>
              <BinderPage />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  localStorage.setItem('mtg-binder-view-mode', 'list');
  useAuth.setState({ status: 'guest' });
  useCollectionStore.setState({
    hydrating: false,
    search: '',
    cards: [bolt] as never,
    binders: [binderWith([]).def] as never,
  });
});

afterEach(() => {
  cleanup();
  sync.state = 'ready';
  sync.listeners.clear();
  layout.settled = true;
  localStorage.clear();
  toastShow.mockClear();
  viewProps.last = null;
});

describe('binder page: a link to one copy', () => {
  it('lands on the page grid without changing the remembered view', () => {
    renderAt('/collection/binders/b1?copy=c1');
    expect(screen.getByText('PAGE GRID')).toBeTruthy();
    expect(viewProps.last?.locate).toEqual({ binderId: 'b1', copyId: 'c1' });
    expect(localStorage.getItem('mtg-binder-view-mode')).toBe('list');
  });

  it('spends the link once the page is open, and stays on the grid', () => {
    renderAt('/collection/binders/b1?copy=c1');
    act(() => viewProps.last?.onLocated?.(true));
    expect(where()).toBe('/collection/binders/b1');
    expect(screen.getByText('PAGE GRID')).toBeTruthy();
    expect(viewProps.last?.locate).toBeNull();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('says so, and spends the link, when the copy is no longer in the binder', () => {
    renderAt('/collection/binders/b1?copy=gone');
    expect(viewProps.last?.locate).toBeNull();
    expect(toastShow).toHaveBeenCalledTimes(1);
    expect(toastShow).toHaveBeenCalledWith({
      message: "That copy isn't in Red Spells anymore.",
      tone: 'info',
    });
    expect(where()).toBe('/collection/binders/b1');
  });

  it('keeps the link while a search hides the copy, and opens it once cleared', async () => {
    // Every card hidden: the view is the binder's empty state, which never
    // looks for a copy, so the page has to say why.
    useCollectionStore.setState({ search: 'counterspell' });
    renderAt('/collection/binders/b1?copy=c1');
    expect(viewProps.last?.locate).toBeNull();
    expect(toastShow).toHaveBeenCalledTimes(1);
    const shown = toastShow.mock.calls[0][0] as { message: string; onAction: () => void };
    expect(shown.message).toBe('Your search hides that copy.');
    expect(where()).toBe('/collection/binders/b1?copy=c1');
    act(() => shown.onAction());
    expect(useCollectionStore.getState().search).toBe('');
    await waitFor(() => expect(viewProps.last?.locate).toEqual({ binderId: 'b1', copyId: 'c1' }));
    expect(toastShow).toHaveBeenCalledTimes(1);
  });

  it('waits for the first pull before calling the copy gone', () => {
    // A cold tab: the binder and some cards came down before the Bolt did.
    useAuth.setState({ status: 'authed', user: { id: 'u1', username: 'tester' } as never });
    useCollectionStore.setState({ cards: [{ ...bolt, copyId: 'c9' }] as never });
    sync.state = 'syncing';
    renderAt('/collection/binders/b1?copy=c1');
    expect(toastShow).not.toHaveBeenCalled();
    expect(where()).toBe('/collection/binders/b1?copy=c1');

    act(() => {
      useCollectionStore.setState({ cards: [bolt] as never });
      sync.state = 'ready';
      sync.listeners.forEach((fn) => fn());
    });
    expect(viewProps.last?.locate).toEqual({ binderId: 'b1', copyId: 'c1' });
    expect(toastShow).not.toHaveBeenCalled();
  });

  it("waits for a tag rule's data before calling the copy gone", () => {
    // A cold tab: every card is in, but the tag snapshot the binder's rule
    // matches on is still loading, so the binder looks empty for a moment.
    layout.settled = false;
    renderAt('/collection/binders/b1?copy=c1');
    expect(toastShow).not.toHaveBeenCalled();
    expect(where()).toBe('/collection/binders/b1?copy=c1');

    act(() => {
      layout.settled = true;
      useCollectionStore.setState({ cards: [bolt] as never });
    });
    expect(viewProps.last?.locate).toEqual({ binderId: 'b1', copyId: 'c1' });
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('opens the remembered view on a plain visit', () => {
    renderAt('/collection/binders/b1');
    expect(screen.getByText('LIST VIEW')).toBeTruthy();
    expect(viewProps.last).toBeNull();
  });
});
