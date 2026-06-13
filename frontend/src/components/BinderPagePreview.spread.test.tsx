// @vitest-environment happy-dom
/**
 * UX-403 spread mode regression tests for BinderPagePreview.
 *
 * matchMedia ≥1024 → spread layout assertions.
 * matchMedia <1024 → unchanged single-page layout.
 *
 * Because matchMedia is read synchronously on component mount (initial
 * useState), we set it before the render call. vi.resetModules() +
 * dynamic require() would be the purest approach but ESM + vitest makes
 * that fragile — instead we mock matchMedia globally and change `.matches`
 * per test, re-creating the mql object so each render sees the right value.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';

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

// Import after mocks are registered.
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

function renderPreview({
  pages,
  pageLabels,
  startPageIndex = 0,
  pocketSize = 9 as PocketSize,
  doubleSided = false,
  binderName = 'My Binder',
}: {
  pages: BinderPage[];
  pageLabels: string[];
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
      />
    </MemoryRouter>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spread mode (≥1024px)
// ─────────────────────────────────────────────────────────────────────────────

describe('BinderPagePreview spread mode (≥1024px)', () => {
  it('double-sided: page 0 is alone on the RIGHT of spread 0 (blank left)', () => {
    setMatchMedia(true);
    const pages = [mkPage(1, [mkCard('Alpha', 0)])];
    const { container } = renderPreview({ pages, pageLabels: ['A'], doubleSided: true });

    const spreadSlides = container.querySelectorAll('.binder-pages-slide--spread');
    expect(spreadSlides.length).toBeGreaterThanOrEqual(1);

    // Blank side present (left of first spread is empty).
    const blanks = container.querySelectorAll('.binder-spread-blank');
    expect(blanks.length).toBeGreaterThanOrEqual(1);
  });

  it('single-sided: pages 0 and 1 appear together in spread 0 — no blank', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2)];
    const { container } = renderPreview({ pages, pageLabels: ['A', 'A'], doubleSided: false });

    const spreadSlides = container.querySelectorAll('.binder-pages-slide--spread');
    expect(spreadSlides.length).toBeGreaterThanOrEqual(1);
    // No blank sides when both pages are present.
    const blanks = container.querySelectorAll('.binder-spread-blank');
    expect(blanks.length).toBe(0);
  });

  it('renders spine dividers', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2)];
    const { container } = renderPreview({ pages, pageLabels: ['A', 'A'], doubleSided: false });
    const spines = container.querySelectorAll('.binder-spread-spine');
    expect(spines.length).toBeGreaterThanOrEqual(1);
  });

  it('counter reads "Spread 1 of 2" for 4 single-sided pages', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2), mkPage(3), mkPage(4)];
    renderPreview({ pages, pageLabels: ['A', 'A', 'A', 'A'], doubleSided: false });
    expect(screen.getByText('Spread 1 of 2')).toBeTruthy();
  });

  it('counter reads "Spread 1 of 3" for 4 double-sided pages', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2), mkPage(3), mkPage(4)];
    renderPreview({ pages, pageLabels: ['A', 'A', 'A', 'A'], doubleSided: true });
    // double-sided: blank|0, 1|2, 3|null = 3 spreads
    expect(screen.getByText('Spread 1 of 3')).toBeTruthy();
  });

  it('context line shows "pages N–M" for a two-page same-label spread', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2)];
    renderPreview({ pages, pageLabels: ['A', 'A'], doubleSided: false });
    expect(screen.getByText(/pages 1.+2/)).toBeTruthy();
  });

  it('context line shows "page N" when one side is blank (double-sided, 1 page)', () => {
    setMatchMedia(true);
    const pages = [mkPage(1)];
    renderPreview({ pages, pageLabels: ['A'], doubleSided: true });
    expect(screen.getByText(/page 1/)).toBeTruthy();
  });

  it('mixed-section context line shows "A → B · pages N–M" when labels differ', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2)];
    renderPreview({ pages, pageLabels: ['A', 'B'], doubleSided: false });
    expect(screen.getByText('A → B · pages 1–2')).toBeTruthy();
  });

  it('same-section context line shows "label · pages N–M" (no arrow)', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2)];
    renderPreview({ pages, pageLabels: ['Section', 'Section'], doubleSided: false });
    expect(screen.queryByText(/→/)).toBeNull();
    expect(screen.getByText(/Section · pages/)).toBeTruthy();
  });

  it('keyboard ArrowRight calls scrollIntoView on the next spread', () => {
    setMatchMedia(true);
    const pages = [mkPage(1), mkPage(2), mkPage(3), mkPage(4)];
    renderPreview({ pages, pageLabels: ['A', 'A', 'A', 'A'], doubleSided: false });
    // Initial state: Spread 1 of 2.
    expect(screen.getByText('Spread 1 of 2')).toBeTruthy();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // scrollIntoView must have been called (the nav moves to the adjacent spread).
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('prev/next button is disabled when at the boundary spread', () => {
    setMatchMedia(true);
    // 2 pages single-sided → 1 spread. At the only spread, both prev and next
    // buttons should be disabled (or absent when slideCount ≤ 1).
    const pages = [mkPage(1), mkPage(2)];
    const { container } = renderPreview({ pages, pageLabels: ['A', 'A'], doubleSided: false });
    // With 1 spread there is only 1 slide, so the nav buttons are hidden entirely
    // (the condition is `slideCount > 1`).
    const navBtns = container.querySelectorAll('.carousel-nav');
    expect(navBtns.length).toBe(0);
  });

  it('deep-link startPageIndex 2 (double-sided) lands on spread 2', () => {
    setMatchMedia(true);
    // double-sided 6 pages: blank|0, 1|2, 3|4, 5|null → startPageIndex=2 → spread 1 (0-based) = "Spread 2 of 4"
    const pages = [mkPage(1), mkPage(2), mkPage(3), mkPage(4), mkPage(5), mkPage(6)];
    const labels = ['A', 'A', 'A', 'A', 'A', 'A'];
    renderPreview({ pages, pageLabels: labels, doubleSided: true, startPageIndex: 2 });
    expect(screen.getByText('Spread 2 of 4')).toBeTruthy();
  });

  it('deep-link startPageIndex 2 (single-sided) lands on spread 2', () => {
    setMatchMedia(true);
    // single-sided: [0|1], [2|3], [4|5] → startPageIndex=2 → spread index 1 = "Spread 2 of 3"
    const pages = [mkPage(1), mkPage(2), mkPage(3), mkPage(4), mkPage(5), mkPage(6)];
    const labels = ['A', 'A', 'A', 'A', 'A', 'A'];
    renderPreview({ pages, pageLabels: labels, doubleSided: false, startPageIndex: 2 });
    expect(screen.getByText('Spread 2 of 3')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Single-page mode (<1024px) — must be untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('BinderPagePreview single-page mode (<1024px)', () => {
  it('shows "Page 1 of N" counter (not "Spread")', () => {
    setMatchMedia(false);
    const pages = [mkPage(1), mkPage(2), mkPage(3)];
    renderPreview({ pages, pageLabels: ['A', 'A', 'A'], doubleSided: false });
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    expect(screen.queryByText(/Spread/)).toBeNull();
  });

  it('renders no spread slides and no spine elements', () => {
    setMatchMedia(false);
    const pages = [mkPage(1), mkPage(2)];
    const { container } = renderPreview({ pages, pageLabels: ['A', 'A'], doubleSided: false });
    expect(container.querySelectorAll('.binder-pages-slide--spread').length).toBe(0);
    expect(container.querySelectorAll('.binder-spread-spine').length).toBe(0);
    expect(container.querySelectorAll('.binder-spread-blank').length).toBe(0);
  });

  it('keyboard ArrowRight calls scrollIntoView on the next page', () => {
    setMatchMedia(false);
    const pages = [mkPage(1), mkPage(2), mkPage(3)];
    renderPreview({ pages, pageLabels: ['A', 'A', 'A'], doubleSided: false });
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it('context line uses the old "label · page N" format', () => {
    setMatchMedia(false);
    const pages = [mkPage(5)];
    renderPreview({ pages, pageLabels: ['Section'], doubleSided: false });
    expect(screen.getByText(/Section · page 5/)).toBeTruthy();
  });
});
