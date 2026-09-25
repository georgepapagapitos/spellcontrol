// @vitest-environment happy-dom
/**
 * A phone shows one full-width page per row, so a section's inline teaser drops
 * to one page there: at the desktop cap of three, a 9-pocket section was ~1,500px
 * of scroll before the next section's header. The expander and the page viewer
 * carry the rest.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { BinderPage, EnrichedCard, MaterializedBinder } from '../types';

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
vi.mock('./BinderPagePreview', () => ({ BinderPagePreview: () => null }));
vi.mock('./BinderDriftBanner', () => ({ BinderDriftBanner: () => null }));
vi.mock('./BinderSummaryBar', () => ({ BinderSummaryBar: () => null }));

import { BinderView, PHONE_SECTION_PAGE_CAP, SECTION_PAGE_CAP } from './BinderView';

function stubPhone(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /max-width:\s*600px/.test(query) ? phone : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
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

// One section of five full 9-pocket pages.
const cards = Array.from({ length: 45 }, (_, i) => card(i));
const pages: BinderPage[] = Array.from({ length: 5 }, (_, p) => ({
  pageNum: p + 1,
  slots: cards.slice(p * 9, p * 9 + 9),
}));
const binder: MaterializedBinder = {
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
  sections: [{ key: 'ALL', label: 'All cards', cards, pages }],
  totalCards: 45,
  totalPages: 5,
  totalValue: 0,
};

const renderView = () =>
  render(
    <MemoryRouter>
      <BinderView
        binders={[binder]}
        controls={{ view: 'pages', onViewChange: () => {}, toggles: [] }}
      />
    </MemoryRouter>
  );

describe('binder section page cap', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows one page per section on a phone', () => {
    stubPhone(true);
    const { container } = renderView();
    expect(container.querySelectorAll('.page-wrap')).toHaveLength(PHONE_SECTION_PAGE_CAP);
    expect(container.querySelector('.binder-section-show-more')?.textContent).toBe(
      `+${5 - PHONE_SECTION_PAGE_CAP} more pages`
    );
  });

  it('keeps the wider teaser on a desktop', () => {
    stubPhone(false);
    const { container } = renderView();
    expect(container.querySelectorAll('.page-wrap')).toHaveLength(SECTION_PAGE_CAP);
    expect(PHONE_SECTION_PAGE_CAP).toBeLessThan(SECTION_PAGE_CAP);
  });
});
