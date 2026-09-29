// @vitest-environment happy-dom
/**
 * A section's inline teaser is ONE full row of its page grid, however many
 * columns the width fits. It used to be a fixed three pages: on a wide monitor
 * the row fits seven, so four columns sat empty above a "+32 more pages"
 * button; on a phone three stacked ~520px pages cost a screen and a half per
 * section. The count is read back from the rendered grid, so these tests stand
 * in for each device by stubbing the grid's resolved `grid-template-columns`.
 */
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { BinderPage, BinderSection, EnrichedCard, MaterializedBinder } from '../types';

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
vi.mock('@/lib/collection/allocations', () => ({ useAllocations: () => new Map() }));
vi.mock('./CardPreview', () => ({ CardPreview: () => null }));
vi.mock('./CardEditDialog', () => ({ CardEditDialog: () => null }));
vi.mock('./BinderPagePreview', () => ({ BinderPagePreview: () => null }));
vi.mock('./BinderDriftBanner', () => ({ BinderDriftBanner: () => null }));
vi.mock('./BinderSummaryBar', () => ({ BinderSummaryBar: () => null }));

import { BinderView, PAGE_RUN_ROWS } from './BinderView';

/** Make every page grid report `cols` laid-out tracks, as the browser would at
 *  that width. */
function stubColumns(cols: number) {
  const real = window.getComputedStyle.bind(window);
  vi.stubGlobal('getComputedStyle', (el: Element) => {
    const style = real(el);
    if (!el.classList.contains('page-row')) return style;
    const tracks = Array.from({ length: cols }, () => '252px').join(' ');
    return new Proxy(style, {
      get: (t, k) => (k === 'gridTemplateColumns' ? tracks : Reflect.get(t, k)),
    });
  });
}

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

/** One section of `n` full 9-pocket pages; `packed` gives it the per-page
 *  labels of a page-filled binder, which renders as one continuous run. */
function binderOf(n: number, packed = false): MaterializedBinder {
  const cards = Array.from({ length: n * 9 }, (_, i) => card(i));
  const pages: BinderPage[] = Array.from({ length: n }, (_, p) => ({
    pageNum: p + 1,
    slots: cards.slice(p * 9, p * 9 + 9),
    ...(packed ? { labels: [`Drop ${p}`] } : {}),
  }));
  const section: BinderSection = {
    key: 'ALL',
    label: 'All cards',
    cards,
    pages,
    ...(packed ? { labels: ['Drop A', 'Drop B'] } : {}),
  };
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
    totalPages: n,
    totalValue: 0,
  };
}

const renderView = (binder: MaterializedBinder) =>
  render(
    <MemoryRouter>
      <BinderView
        binders={[binder]}
        controls={{ view: 'pages', onViewChange: () => {}, toggles: [] }}
      />
    </MemoryRouter>
  );

const pagesShown = (c: HTMLElement) => c.querySelectorAll('.page-wrap').length;
const expander = (c: HTMLElement) => c.querySelector('.binder-section-show-more');

describe('binder section page cap', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Column counts measured in Edge on the production build, 9-pocket pages.
  it.each([
    ['a phone (320–599px)', 1],
    ['a portrait tablet (768px)', 2],
    ['a landscape phone or small laptop (820–1024px)', 3],
    ['a laptop (1280–1440px)', 5],
    ['a 1920px monitor', 7],
  ])('fills exactly one row on %s (%i columns)', (_, cols) => {
    stubColumns(cols);
    const { container } = renderView(binderOf(35));
    expect(pagesShown(container)).toBe(cols);
    expect(expander(container)?.textContent).toBe(`+${35 - cols} more pages`);
  });

  it('shows a section that fits in one row whole, with no expander', () => {
    stubColumns(7);
    const { container } = renderView(binderOf(5));
    expect(pagesShown(container)).toBe(5);
    expect(expander(container)).toBeNull();
  });

  it('says "page" for a single hidden page', () => {
    stubColumns(4);
    const { container } = renderView(binderOf(5));
    expect(expander(container)?.textContent).toBe('+1 more page');
  });

  it('expands to every page', () => {
    stubColumns(4);
    const { container } = renderView(binderOf(35));
    fireEvent.click(expander(container)!);
    expect(pagesShown(container)).toBe(35);
    expect(expander(container)).toBeNull();
  });

  it('gives a page-filled binder’s continuous run full rows too', () => {
    stubColumns(7);
    const { container } = renderView(binderOf(35, true));
    expect(container.querySelector('.binder-section')).toBeNull();
    expect(pagesShown(container)).toBe(7 * PAGE_RUN_ROWS);
    expect(expander(container)?.textContent).toBe(`+${35 - 7 * PAGE_RUN_ROWS} more pages`);
  });
});
