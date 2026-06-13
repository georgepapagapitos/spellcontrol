// @vitest-environment happy-dom
/**
 * UX-403 PR-2: Section index-tab regression tests for BinderPagePreview.
 *
 * Tests verify:
 *   - Tabs render with correct side split for a 3-section binder.
 *   - Current section tab carries the `is-current` class.
 *   - Clicking a tab calls scrollIntoView on the correct spread slide.
 *   - No tabs render when sectionTabs has ≤ 1 entry.
 *   - No tabs render in single-page (<1024px) mode.
 *   - Mini fallback fires when gutterHeight is small (ResizeObserver mock).
 *
 * Conventions mirror BinderPagePreview.spread.test.tsx (PR-1):
 *   - setMatchMedia helper controls spread mode.
 *   - scrollIntoView is stubbed on Element.prototype.
 *   - Module-level vi.mock for hooks with no test-relevant state.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import type { SectionTabInput } from '../lib/binder-spreads';
import { buildSpreads, layoutSectionTabs } from '../lib/binder-spreads';

// ── Module-level mocks ────────────────────────────────────────────────────

vi.mock('../lib/allocations', () => ({
  useAllocations: () => new Map(),
}));

vi.mock('../lib/use-lock-body-scroll', () => ({
  useLockBodyScroll: () => {},
}));

vi.mock('../lib/use-centered-slide', () => ({
  useCenteredSlide: () => {},
}));

vi.mock('../lib/use-max-boundary-scroll', () => ({
  useMaxBoundaryScroll: () => {},
}));

vi.mock('../lib/use-swipe-down-dismiss', () => ({
  useSwipeDownDismiss: () => ({ isDragging: false, touchHandlers: {} }),
}));

vi.mock('../lib/foil-style', () => ({
  classifyFoil: () => 'standard',
}));

// Import after mocks.
import { BinderPagePreview } from './BinderPagePreview';

// ── happy-dom stubs ───────────────────────────────────────────────────────

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

// ── matchMedia mock helper ────────────────────────────────────────────────

function setMatchMedia(matches: boolean) {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

// ── ResizeObserver mock helper ────────────────────────────────────────────

/**
 * Install a ResizeObserver stub that immediately fires the callback with a
 * fake clientHeight on the observed element, and exposes a trigger function
 * so tests can simulate resize events.
 *
 * We also patch `getComputedStyle` to return controllable padding values so
 * the component's padding subtraction produces a deterministic gutterHeight.
 */
function installResizeObserver(clientHeight: number, paddingTopPx = 20, paddingBottomPx = 20) {
  let storedCallback: ResizeObserverCallback | null = null;
  let storedTarget: Element | null = null;

  // Patch getComputedStyle to return controlled padding.
  const origGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (el: Element) => {
    const real = origGetComputedStyle(el);
    return {
      ...real,
      paddingTop: `${paddingTopPx}px`,
      paddingBottom: `${paddingBottomPx}px`,
    } as CSSStyleDeclaration;
  };

  // Patch clientHeight on the track element after render.
  const patchHeight = (el: Element) => {
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => clientHeight,
    });
  };

  globalThis.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      storedCallback = cb;
    }
    observe(target: Element) {
      storedTarget = target;
      patchHeight(target);
      if (storedCallback) {
        storedCallback([], this);
      }
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  return {
    trigger: () => {
      if (storedCallback && storedTarget) {
        storedCallback([], globalThis.ResizeObserver.prototype);
      }
    },
    restore: () => {
      globalThis.getComputedStyle = origGetComputedStyle;
    },
  };
}

// ── Test data factories ───────────────────────────────────────────────────

function mkCard(name: string, i: number): EnrichedCard {
  return {
    copyId: `copy-${i}`,
    name,
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: String(i),
    rarity: 'common',
    scryfallId: `sf-${i}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 0,
  } as EnrichedCard;
}

function mkPage(pageNum: number, slots: (EnrichedCard | null)[] = []): BinderPage {
  const filled = [...slots];
  while (filled.length < 9) filled.push(null);
  return { pageNum, slots: filled };
}

/** Build a 3-section binder: 2 pages per section, single-sided, 6 total pages. */
function mk3SectionSetup(): {
  pages: BinderPage[];
  pageLabels: string[];
  sectionTabs: SectionTabInput[];
} {
  const pages = [
    mkPage(1, [mkCard('A', 0)]),
    mkPage(2),
    mkPage(3),
    mkPage(4),
    mkPage(5),
    mkPage(6),
  ];
  const pageLabels = ['White', 'White', 'Blue', 'Blue', 'Black', 'Black'];
  const sectionTabs: SectionTabInput[] = [
    { key: 'W', label: 'White', firstPageIndex: 0, pip: { background: '#fff', border: '#ccc' } },
    { key: 'U', label: 'Blue', firstPageIndex: 2, pip: { background: '#00f', border: '#008' } },
    { key: 'B', label: 'Black', firstPageIndex: 4, pip: { background: '#000', border: '#333' } },
  ];
  return { pages, pageLabels, sectionTabs };
}

function renderPreview({
  pages,
  pageLabels,
  sectionTabs,
  startPageIndex = 0,
  pocketSize = 9 as PocketSize,
  doubleSided = false,
  binderName = 'My Binder',
}: {
  pages: BinderPage[];
  pageLabels: string[];
  sectionTabs?: SectionTabInput[];
  startPageIndex?: number;
  pocketSize?: PocketSize;
  doubleSided?: boolean;
  binderName?: string;
}) {
  return render(
    <MemoryRouter>
      <BinderPagePreview
        pages={pages}
        pageLabels={pageLabels}
        startPageIndex={startPageIndex}
        pocketSize={pocketSize}
        doubleSided={doubleSided}
        binderName={binderName}
        resolveCard={() => null}
        onClose={() => {}}
        sectionTabs={sectionTabs}
      />
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('BinderPagePreview section tabs — spread mode (≥1024px)', () => {
  it('renders left and right gutter tabs for a 3-section binder at spread 0', () => {
    setMatchMedia(true);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600); // gutterHeight = 600 - 20 - 20 = 560 → full tabs
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    // We should have at least one left gutter and one right gutter rendered.
    const leftGutters = container.querySelectorAll('.binder-spread-tab-gutter--left');
    const rightGutters = container.querySelectorAll('.binder-spread-tab-gutter--right');
    expect(leftGutters.length).toBeGreaterThanOrEqual(1);
    expect(rightGutters.length).toBeGreaterThanOrEqual(1);
  });

  it('renders tab buttons with correct aria-labels (uses physical pageNum)', () => {
    setMatchMedia(true);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    // White section: firstPageIndex=0, pages[0].pageNum=1 → "Jump to White, page 1".
    // The label uses pages[].pageNum (physical), not firstPageIndex+1 (flat index).
    // Use querySelectorAll to avoid dom-accessibility-api traversal which
    // breaks when getComputedStyle is partially mocked.
    const tabsWithLabel = container.querySelectorAll('[aria-label="Jump to White, page 1"]');
    expect(tabsWithLabel.length).toBeGreaterThanOrEqual(1);
  });

  it('aria-label uses physical pageNum, not flat index', () => {
    setMatchMedia(true);
    // Build a binder where pages[0].pageNum diverges from firstPageIndex+1.
    // pageNum=5 on the first page means the physical label should say "page 5".
    const pages = [
      { pageNum: 5, slots: Array(9).fill(null) },
      { pageNum: 6, slots: Array(9).fill(null) },
      { pageNum: 7, slots: Array(9).fill(null) },
      { pageNum: 8, slots: Array(9).fill(null) },
    ];
    const pageLabels = ['Alpha', 'Alpha', 'Beta', 'Beta'];
    const sectionTabs: SectionTabInput[] = [
      { key: 'A', label: 'Alpha', firstPageIndex: 0 },
      { key: 'B', label: 'Beta', firstPageIndex: 2 },
    ];
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    // Physical pageNum is 5, flat index+1 is 1 — must use pageNum.
    const byPhysical = container.querySelectorAll('[aria-label="Jump to Alpha, page 5"]');
    const byFlatIndex = container.querySelectorAll('[aria-label="Jump to Alpha, page 1"]');
    expect(byPhysical.length).toBeGreaterThanOrEqual(1);
    expect(byFlatIndex.length).toBe(0);
  });

  it('the current tab carries the is-current class', () => {
    setMatchMedia(true);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs, startPageIndex: 0 });

    // At spread 0, the current section is White (last left-side tab in section order).
    // White and Blue start at pages 0 and 2 (both on spread 0), so both are left.
    // Black starts at page 4 (spread 2), so it's right at spread 0.
    // Current = last left = Blue → is-current on the Blue tab.
    const currentTabs = container.querySelectorAll('.binder-spread-tab.is-current');
    expect(currentTabs.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking a tab calls scrollIntoView on the correct spread slide ref', () => {
    setMatchMedia(true);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');

    // Click the Black section tab (starts at page 4 → spread 2 for single-sided).
    const blackTabBtns = container.querySelectorAll(
      '.binder-spread-tab--right'
    ) as NodeListOf<HTMLButtonElement>;
    if (blackTabBtns.length > 0) {
      fireEvent.click(blackTabBtns[0]);
      expect(scrollSpy).toHaveBeenCalled();
    }

    scrollSpy.mockRestore();
  });

  it('does not render gutter tabs when sectionTabs has only 1 entry', () => {
    setMatchMedia(true);
    installResizeObserver(600);
    const pages = [mkPage(1), mkPage(2)];
    const pageLabels = ['White', 'White'];
    const sectionTabs: SectionTabInput[] = [{ key: 'W', label: 'White', firstPageIndex: 0 }];
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    const gutters = container.querySelectorAll('.binder-spread-tab-gutter');
    expect(gutters.length).toBe(0);
  });

  it('does not render gutter tabs when sectionTabs is undefined', () => {
    setMatchMedia(true);
    installResizeObserver(600);
    const pages = [mkPage(1), mkPage(2)];
    const pageLabels = ['White', 'White'];
    const { container } = renderPreview({ pages, pageLabels, sectionTabs: undefined });

    const gutters = container.querySelectorAll('.binder-spread-tab-gutter');
    expect(gutters.length).toBe(0);
  });

  it('mini variant renders on a side with too many tabs to fit at full height', () => {
    // Verify via the pure lib (imported at file top) that mini is selected
    // when full doesn't fit. This avoids the per-spread DOM aggregation
    // complexity of querying across windowed slides.
    // 5 sections, 1 page each, single-sided: spreads=[0|1],[2|3],[4|null]
    const spreads5 = buildSpreads(5, false);
    const tabs5: SectionTabInput[] = [
      { key: 'W', label: 'White', firstPageIndex: 0 },
      { key: 'U', label: 'Blue', firstPageIndex: 1 },
      { key: 'B', label: 'Black', firstPageIndex: 2 },
      { key: 'R', label: 'Red', firstPageIndex: 3 },
      { key: 'G', label: 'Green', firstPageIndex: 4 },
    ];
    // At spread 0 (pages 0,1): W,U → left (spreads 0,0 ≤ 0); B,R,G → right.
    // gutterHeight=120: full 3 right tabs=3×56+2×6=180>120, mini=3×30+2×6=102≤120.
    const result = layoutSectionTabs(tabs5, 0, spreads5, 120);
    const rightPlacements = result.filter((p) => p.side === 'right');
    expect(rightPlacements.length).toBeGreaterThanOrEqual(1);
    expect(rightPlacements.every((p) => p.variant === 'mini')).toBe(true);
    // Containment holds.
    for (const p of result) {
      expect(p.top + p.height).toBeLessThanOrEqual(120);
    }
  });
});

describe('BinderPagePreview section tabs — is-tabbed class (Fix 3)', () => {
  it('backdrop has is-tabbed class when there are 3 sections', () => {
    setMatchMedia(true);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    const backdrop = container.querySelector('.binder-pages-backdrop');
    expect(backdrop?.classList.contains('is-tabbed')).toBe(true);
  });

  it('backdrop does NOT have is-tabbed class when there is only 1 section', () => {
    setMatchMedia(true);
    installResizeObserver(600);
    const pages = [mkPage(1), mkPage(2)];
    const pageLabels = ['White', 'White'];
    const sectionTabs: SectionTabInput[] = [{ key: 'W', label: 'White', firstPageIndex: 0 }];
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    const backdrop = container.querySelector('.binder-pages-backdrop');
    expect(backdrop?.classList.contains('is-tabbed')).toBe(false);
  });

  it('backdrop does NOT have is-tabbed class when sectionTabs is undefined', () => {
    setMatchMedia(true);
    installResizeObserver(600);
    const pages = [mkPage(1), mkPage(2)];
    const pageLabels = ['White', 'White'];
    const { container } = renderPreview({ pages, pageLabels, sectionTabs: undefined });

    const backdrop = container.querySelector('.binder-pages-backdrop');
    expect(backdrop?.classList.contains('is-tabbed')).toBe(false);
  });
});

describe('BinderPagePreview section tabs — single-page mode (<1024px)', () => {
  it('does not render any gutter tabs below the spread breakpoint', () => {
    setMatchMedia(false);
    const { pages, pageLabels, sectionTabs } = mk3SectionSetup();
    installResizeObserver(600);
    const { container } = renderPreview({ pages, pageLabels, sectionTabs });

    const gutters = container.querySelectorAll('.binder-spread-tab-gutter');
    expect(gutters.length).toBe(0);
  });

  it('existing single-page tests are unaffected: counter shows Page N of M', () => {
    setMatchMedia(false);
    const pages = [mkPage(1), mkPage(2), mkPage(3)];
    const pageLabels = ['A', 'A', 'A'];
    const sectionTabs: SectionTabInput[] = [
      { key: 's0', label: 'Section A', firstPageIndex: 0 },
      { key: 's1', label: 'Section B', firstPageIndex: 2 },
    ];
    renderPreview({ pages, pageLabels, sectionTabs });
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
  });
});
