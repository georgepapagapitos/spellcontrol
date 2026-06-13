import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import { CardPreview } from './CardPreview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useMaxBoundaryScroll } from '../lib/use-max-boundary-scroll';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { classifyFoil } from '../lib/foil-style';
import { buildSpreads, spreadIndexForPage, layoutSectionTabs } from '../lib/binder-spreads';
import type { SectionTabInput, TabPlacement, Spread } from '../lib/binder-spreads';
import { ColorPip } from './shared/ManaSymbol';

export interface InnerCardScope {
  cards: EnrichedCard[];
  index: number;
  sectionLabels: string[];
  pageNumbers: number[];
  totalPages: number;
}

interface Props {
  pages: BinderPage[];
  /** Per-page sub-label (e.g. section name). Parallel array to `pages`. */
  pageLabels: string[];
  startPageIndex: number;
  pocketSize: PocketSize;
  binderName: string;
  /**
   * Whether the physical binder is double-sided (sheet backs are discrete
   * pages). Controls verso/recto pairing in spread mode.
   */
  doubleSided?: boolean;
  /**
   * Resolve a tapped card to the scope used by the inner CardPreview
   * (which list to walk for prev/next, where to start, etc). Return null
   * to no-op the tap.
   */
  resolveCard: (card: EnrichedCard) => InnerCardScope | null;
  onClose: () => void;
  /** Forwarded to the inner CardPreview's Edit button. */
  onEditCard?: (card: EnrichedCard) => void;
  /** Group-printings qty by copyId — forwarded to inner CardPreview's ×N tag. */
  qtyByCopyId?: Map<string, number>;
  /**
   * Section index tabs for spread mode (≥1024px). When provided and the
   * binder has more than 1 section, physical index-tab dividers appear in the
   * left/right gutters outside the spread slide. No-op in single-page mode.
   */
  sectionTabs?: SectionTabInput[];
}

// Pages within this many slides of the focus mount their full pocket grid;
// the rest render as bare placeholder slides that hold the scroll slot only.
// Mirrors CardPreview's windowing — keeps the carousel light on large binders
// without disturbing native scroll-snap (every page keeps a sized slide div).
const PAGE_WINDOW_RADIUS = 5;

// In spread mode each slide mounts two grids, so tighten the window to keep
// the DOM light for large binders.
const SPREAD_WINDOW_RADIUS = 3;

// Breakpoint at which the spread layout activates (≥1024px).
const SPREAD_BREAKPOINT = '(min-width: 1024px)';

/** Returns true when the viewport is at or above the spread breakpoint. */
function querySpreadMode(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(SPREAD_BREAKPOINT).matches;
}

/**
 * Subscribes to the spread breakpoint and returns the current match state.
 * Safe in node/test environments (matchMedia absent → always false).
 */
function useSpreadMode(): boolean {
  const [active, setActive] = useState<boolean>(() => querySpreadMode());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(SPREAD_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setActive(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return active;
}

export function BinderPagePreview({
  pages,
  pageLabels,
  startPageIndex,
  pocketSize,
  binderName,
  doubleSided = false,
  resolveCard,
  onClose,
  onEditCard,
  qtyByCopyId,
  sectionTabs,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);

  // The available height for gutter tab columns equals the track's clientHeight
  // minus its vertical padding (1.25rem top + 1.25rem bottom ≈ 40px at 16px
  // base). We measure the track element via ResizeObserver and subtract the
  // padding so tabs never overflow the visible slide height.
  // Guard: ResizeObserver is absent in test environments (happy-dom) → we
  // start at 0 so no tabs render until the observer fires (or never in tests
  // unless mocked).
  const [gutterHeight, setGutterHeight] = useState(0);

  // Each page is one carousel slide. (Double-sided binders are modelled as
  // pocketSize-per-side already; the back of a sheet is its own page in the
  // pages[] list.)
  const cols = pocketSize === 4 ? 2 : pocketSize === 12 ? 4 : 3;
  const rows = pocketSize === 4 ? 2 : 3;
  // Page rectangle aspect = (cols × card-w) : (rows × card-h). Lets each
  // pocket land at the natural 5:7 card aspect regardless of pocket count
  // (4-pocket → 5:7, 9-pocket → 5:7, 12-pocket → 20:21 wide).
  const slideAspect = `${cols * 5} / ${rows * 7}`;
  // Same ratio expressed as width÷height — used by --slide-size to bound
  // the slide width by viewport height, so 12-pocket (wider) pages can
  // grow more on short viewports than tall 9-pocket pages.
  const pageAspectRatio = (cols * 5) / (rows * 7);

  const isSpread = useSpreadMode();
  const spreads = useMemo(
    () => (isSpread ? buildSpreads(pages.length, doubleSided) : []),
    [isSpread, pages.length, doubleSided]
  );

  // `selected` is a page index in single mode, a spread index in spread mode.
  const [selected, setSelected] = useState(() =>
    isSpread
      ? Math.max(0, spreadIndexForPage(buildSpreads(pages.length, doubleSided), startPageIndex))
      : startPageIndex
  );

  const [innerCard, setInnerCard] = useState<InnerCardScope | null>(null);

  // O(1) lookup from card → flat page index, so we can keep the flipbook in
  // sync as the user navigates cards in the inner CardPreview.
  const cardToPageIndex = useMemo(() => {
    const m = new Map<EnrichedCard, number>();
    pages.forEach((p, i) => {
      p.slots.forEach((slot) => {
        if (slot && !m.has(slot)) m.set(slot, i);
      });
    });
    return m;
  }, [pages]);

  // Follow-along: when the user navigates to a card on a DIFFERENT page in the
  // inner CardPreview, snap the background flipbook to that page. Instant
  // (not smooth) so the background change reads as "stays in sync with the
  // foreground" rather than as its own scrolling animation.
  useEffect(() => {
    if (!innerCard) return;
    const card = innerCard.cards[innerCard.index];
    if (!card) return;
    const targetPage = cardToPageIndex.get(card);
    if (targetPage === undefined) return;

    if (isSpread) {
      const targetSpread = spreadIndexForPage(spreads, targetPage);
      if (targetSpread === -1 || targetSpread === selected) return;
      slideRefs.current[targetSpread]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    } else {
      if (targetPage === selected) return;
      slideRefs.current[targetPage]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    }
  }, [innerCard, cardToPageIndex, selected, isSpread, spreads]);

  // Initial scroll: jump to the requested page without animation.
  useLayoutEffect(() => {
    const targetIdx = isSpread
      ? Math.max(0, spreadIndexForPage(spreads, startPageIndex))
      : startPageIndex;
    const slide = slideRefs.current[targetIdx];
    if (slide) {
      slide.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-center when crossing the spread/single breakpoint. Track the current
  // representative page (right side of spread if available, else left), then
  // remap it when the mode changes.
  const selectedPageRef = useRef(startPageIndex);
  useLayoutEffect(() => {
    if (isSpread) {
      // Entering spread mode: map saved page → its spread.
      const spreadIdx = Math.max(0, spreadIndexForPage(spreads, selectedPageRef.current));
      setSelected(spreadIdx);
      slideRefs.current[spreadIdx]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    } else {
      // Leaving spread mode: restore saved page.
      const pageIdx = selectedPageRef.current;
      setSelected(pageIdx);
      slideRefs.current[pageIdx]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpread]);

  // Keep selectedPageRef in sync with `selected` so breakpoint re-entry uses
  // the most recent page.
  useEffect(() => {
    if (isSpread) {
      const s = spreads[selected];
      if (s) selectedPageRef.current = s.right ?? s.left ?? 0;
    } else {
      selectedPageRef.current = selected;
    }
  }, [selected, isSpread, spreads]);

  const slideCount = isSpread ? spreads.length : pages.length;

  useCenteredSlide(trackRef, slideRefs, setSelected, [pages, spreads]);

  // Clamp the native scroll so a momentum fling can't rubber-band past the
  // first/last page (mirrors CardPreview — same WebView overscroll gap).
  useMaxBoundaryScroll(trackRef);

  useLockBodyScroll();

  // Symmetric exit: every flipbook dismiss path plays sheet-fall, then
  // unmounts — same treatment as the inner CardPreview.
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(onClose);

  // Keyboard nav.
  useEffect(() => {
    if (innerCard) return; // let CardPreview own keys while it's open
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        beginClose();
        return;
      }
      let next: number | null = null;
      if (e.key === 'ArrowLeft') next = Math.max(0, selected - 1);
      else if (e.key === 'ArrowRight') next = Math.min(slideCount - 1, selected + 1);
      if (next === null || next === selected) return;
      slideRefs.current[next]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beginClose, selected, slideCount, innerCard]);

  const { isDragging, touchHandlers } = useSwipeDownDismiss({
    onDismiss: beginClose,
    sheetRef,
    trackRef,
  });

  // The hook drives the drag offset imperatively on the sheet. Clear that
  // inline transform once the gesture ends (and we're not dismissing) so the
  // CSS snap-back transition animates the sheet home; a dismiss leaves it for
  // the sheet-fall keyframe. Mirrors CardPreview.
  useLayoutEffect(() => {
    if (isDragging || isClosing) return;
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transform = '';
  }, [isDragging, isClosing]);

  const allocations = useAllocations();

  // Measure the track's clientHeight (minus its own vertical padding) so the
  // tab layout lib knows how much vertical space the gutter columns have.
  // Padding constants mirror the CSS values set on .binder-pages-track:
  //   ≥601px → paddingTop:1.25rem, paddingBottom:1.25rem   (≈ 40px each)
  //   ≤600px → paddingTop:0.75rem, paddingBottom:1.25rem   (≈ 12 + 20 = 32px)
  // We compute from `getComputedStyle` so the actual rendered padding drives
  // the number regardless of viewport size.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const track = trackRef.current;
    if (!track) return;

    const update = () => {
      const style = getComputedStyle(track);
      const pt = parseFloat(style.paddingTop) || 0;
      const pb = parseFloat(style.paddingBottom) || 0;
      setGutterHeight(Math.max(0, track.clientHeight - pt - pb));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  const handleCardTap = (card: EnrichedCard) => {
    const scope = resolveCard(card);
    if (scope) setInnerCard(scope);
  };

  if (pages.length === 0) return null;

  // Same model as CardPreview: the sheet is a transparent transform carrier
  // (only the opaque binder page + info panel rise); the dim sits on the
  // backdrop, which stays put, fades in/out (.is-closing), and carries the
  // sizing var (--page-w-ratio drives --slide-size).
  //
  // In spread mode the slide contains [left-page | spine | right-page].
  // We reserve exactly 1 ratio-unit for the spine in --page-w-ratio so
  // min() still clamps the slide to the track. --spread-page-frac and
  // --spread-spine-frac let the CSS assign exact fractional widths to each
  // child so that pages + spine sum to exactly --slide-size — eliminating
  // the few-px height-overflow that occurred when the CSS clamp-based spine
  // width didn't match the JS-reserved unit.
  const spreadAspectRatio = (2 * cols * 5 + 1) / (rows * 7);
  const spreadPageFrac = (cols * 5) / (2 * cols * 5 + 1);
  const spreadSpineFrac = 1 / (2 * cols * 5 + 1);
  const backdropStyle = {
    ['--page-w-ratio' as string]: isSpread ? spreadAspectRatio : pageAspectRatio,
    ...(isSpread && {
      ['--spread-page-frac' as string]: spreadPageFrac,
      ['--spread-spine-frac' as string]: spreadSpineFrac,
    }),
  } as React.CSSProperties;

  // Panel display helpers for spread mode.
  const panelInfo = (): { contextLine: string; counterLine: string } => {
    if (!isSpread) {
      const currentPage = pages[selected];
      const currentLabel = pageLabels[selected] ?? '';
      return {
        contextLine: `${currentLabel ? `${currentLabel} · ` : ''}page ${currentPage?.pageNum}`,
        counterLine: `Page ${selected + 1} of ${pages.length}`,
      };
    }
    const spread = spreads[selected];
    if (!spread) {
      return { contextLine: '', counterLine: '' };
    }
    const leftPage = spread.left !== null ? pages[spread.left] : null;
    const rightPage = spread.right !== null ? pages[spread.right] : null;
    const leftNum = leftPage?.pageNum;
    const rightNum = rightPage?.pageNum;
    const leftLabel = spread.left !== null ? (pageLabels[spread.left] ?? '') : '';
    const rightLabel = spread.right !== null ? (pageLabels[spread.right] ?? '') : '';

    // Section / label context line.
    let contextLine: string;
    if (leftLabel && rightLabel && leftLabel !== rightLabel) {
      if (leftNum !== undefined && rightNum !== undefined) {
        contextLine = `${leftLabel} → ${rightLabel} · pages ${leftNum}–${rightNum}`;
      } else if (leftNum !== undefined) {
        contextLine = `${leftLabel} → ${rightLabel} · page ${leftNum}`;
      } else if (rightNum !== undefined) {
        contextLine = `${leftLabel} → ${rightLabel} · page ${rightNum}`;
      } else {
        contextLine = `${leftLabel} → ${rightLabel}`;
      }
    } else {
      const label = leftLabel || rightLabel;
      if (leftNum !== undefined && rightNum !== undefined) {
        contextLine = `${label ? `${label} · ` : ''}pages ${leftNum}–${rightNum}`;
      } else if (leftNum !== undefined) {
        contextLine = `${label ? `${label} · ` : ''}page ${leftNum}`;
      } else if (rightNum !== undefined) {
        contextLine = `${label ? `${label} · ` : ''}page ${rightNum}`;
      } else {
        contextLine = label;
      }
    }
    return {
      contextLine,
      counterLine: `Spread ${selected + 1} of ${spreads.length}`,
    };
  };

  const { contextLine, counterLine } = panelInfo();

  const windowRadius = isSpread ? SPREAD_WINDOW_RADIUS : PAGE_WINDOW_RADIUS;
  // True when gutter columns are rendered — used to apply is-tabbed to the
  // backdrop so CSS can scope the gutter-reserving --slide-size override and
  // centering spacers only when tabs are actually present (Fix 3).
  const hasTabs = isSpread && (sectionTabs?.length ?? 0) > 1;

  return (
    <>
      <div
        className={`binder-pages-backdrop${isSpread ? ' is-spread' : ''}${hasTabs ? ' is-tabbed' : ''}${isClosing ? ' is-closing' : ''}`}
        onClick={() => beginClose()}
        role="dialog"
        aria-modal="true"
        style={backdropStyle}
      >
        <div
          ref={sheetRef}
          className={`binder-pages-sheet${isDragging ? ' is-dragging' : ''}${
            isClosing ? ' is-closing' : ''
          }`}
          style={exitStyle}
          onAnimationEnd={onAnimationEnd}
          {...touchHandlers}
        >
          <button
            type="button"
            className="card-preview-close"
            onClick={(e) => {
              e.stopPropagation();
              beginClose();
            }}
            aria-label="Close preview"
          >
            ×
          </button>
          <div className="card-preview-grabber" aria-hidden="true" />
          {slideCount > 1 && (
            // Mirror CardPreview: the prev/next arrows MUST live inside
            // .carousel-nav-layer (grid-row:1 / grid-column:1, overlaying the
            // track cell with justify-content:space-between). Rendered as bare
            // children of the sheet grid they auto-place as in-flow grid items,
            // spawning implicit rows that steal height from the `1fr` track —
            // collapsing the page grid to a sliver and piling the arrows on the
            // left edge. The layer takes them out of the row flow and pins them
            // to opposite edges of the track.
            <div className="carousel-nav-layer">
              <button
                type="button"
                className="carousel-nav carousel-nav-prev"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.max(0, selected - 1);
                  if (next !== selected)
                    slideRefs.current[next]?.scrollIntoView({
                      inline: 'center',
                      block: 'nearest',
                      behavior: 'smooth',
                    });
                }}
                disabled={selected === 0}
                aria-label={isSpread ? 'Previous spread' : 'Previous page'}
              >
                <ChevronLeft width={20} height={20} strokeWidth={2.4} aria-hidden />
              </button>
              <button
                type="button"
                className="carousel-nav carousel-nav-next"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.min(slideCount - 1, selected + 1);
                  if (next !== selected)
                    slideRefs.current[next]?.scrollIntoView({
                      inline: 'center',
                      block: 'nearest',
                      behavior: 'smooth',
                    });
                }}
                disabled={selected === slideCount - 1}
                aria-label={isSpread ? 'Next spread' : 'Next page'}
              >
                <ChevronRight width={20} height={20} strokeWidth={2.4} aria-hidden />
              </button>
            </div>
          )}
          <div className="binder-pages-track" ref={trackRef}>
            {isSpread
              ? spreads.map((spread, i) => {
                  const slideRef = (el: HTMLDivElement | null) => {
                    slideRefs.current[i] = el;
                  };

                  // `tabbed` is true whenever the binder has >1 section in spread mode,
                  // regardless of whether this particular slide is inside the render window.
                  // Computing it once (not gated by windowRadius) means placeholder slides
                  // and full slides always share the same --tabbed flex-basis, so the track
                  // width is stable as slides enter/leave the window.
                  const tabbed = isSpread && (sectionTabs?.length ?? 0) > 1;

                  // Compute tab placements only for windowed slides (pure + cheap).
                  const showPlacements = tabbed && Math.abs(i - selected) <= windowRadius;
                  const tabPlacements = showPlacements
                    ? layoutSectionTabs(sectionTabs!, i, spreads, gutterHeight)
                    : [];
                  const leftPlacements = tabPlacements.filter((p) => p.side === 'left');
                  const rightPlacements = tabPlacements.filter((p) => p.side === 'right');

                  if (Math.abs(i - selected) > windowRadius) {
                    return (
                      <div
                        className={`binder-pages-slide${tabbed ? ' binder-pages-slide--tabbed' : ''}`}
                        ref={slideRef}
                        key={`spread-${i}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    );
                  }
                  return (
                    <div
                      className={`binder-pages-slide binder-pages-slide--spread${i === selected ? ' is-active' : ''}${tabbed ? ' binder-pages-slide--tabbed' : ''}`}
                      ref={slideRef}
                      key={`spread-${i}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {showPlacements && (
                        <SpreadTabGutter
                          placements={leftPlacements}
                          side="left"
                          pages={pages}
                          spreads={spreads}
                          slideRefs={slideRefs}
                        />
                      )}
                      {spread.left !== null ? (
                        <SlideGrid
                          slots={pages[spread.left].slots}
                          cols={cols}
                          rows={rows}
                          aspect={slideAspect}
                          allocations={allocations}
                          onTapCard={handleCardTap}
                        />
                      ) : (
                        <div className="binder-spread-blank" aria-hidden="true" />
                      )}
                      <div className="binder-spread-spine" aria-hidden="true" />
                      {spread.right !== null ? (
                        <SlideGrid
                          slots={pages[spread.right].slots}
                          cols={cols}
                          rows={rows}
                          aspect={slideAspect}
                          allocations={allocations}
                          onTapCard={handleCardTap}
                        />
                      ) : (
                        <div className="binder-spread-blank" aria-hidden="true" />
                      )}
                      {showPlacements && (
                        <SpreadTabGutter
                          placements={rightPlacements}
                          side="right"
                          pages={pages}
                          spreads={spreads}
                          slideRefs={slideRefs}
                        />
                      )}
                    </div>
                  );
                })
              : pages.map((page, i) => {
                  const slideRef = (el: HTMLDivElement | null) => {
                    slideRefs.current[i] = el;
                  };
                  // Out-of-window pages render a bare placeholder: it keeps the
                  // slide's width/scroll-snap slot so native scrolling is intact,
                  // but skips the pocket grid (cols×rows cells) — a few thousand
                  // cells mounted at once is what would jank a large binder.
                  if (Math.abs(i - selected) > windowRadius) {
                    return (
                      <div
                        className="binder-pages-slide"
                        ref={slideRef}
                        key={`${page.pageNum}-${i}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    );
                  }
                  return (
                    <div
                      className={`binder-pages-slide${i === selected ? ' is-active' : ''}`}
                      ref={slideRef}
                      key={`${page.pageNum}-${i}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Page number lives in the bottom info panel; no per-slide
                          label above the grid (was .binder-pages-slide-label). */}
                      <SlideGrid
                        slots={page.slots}
                        cols={cols}
                        rows={rows}
                        aspect={slideAspect}
                        allocations={allocations}
                        onTapCard={handleCardTap}
                      />
                    </div>
                  );
                })}
          </div>

          <div className="binder-pages-panel" onClick={(e) => e.stopPropagation()}>
            <div className="binder-pages-name">{binderName}</div>
            <div className="binder-pages-context">{contextLine}</div>
            <div className="binder-pages-counter">{counterLine}</div>
          </div>
        </div>
      </div>

      {innerCard && (
        <CardPreview
          source="binder"
          cards={innerCard.cards}
          index={innerCard.index}
          binderName={binderName}
          sectionLabels={innerCard.sectionLabels}
          pageNumbers={innerCard.pageNumbers}
          totalPages={innerCard.totalPages}
          getStackAllocations={(i) => {
            const c = innerCard.cards[i];
            const a = c ? allocations.get(c.copyId) : null;
            return a ? [a] : [];
          }}
          getStackQty={(i) => {
            const c = innerCard.cards[i];
            return c ? (qtyByCopyId?.get(c.copyId) ?? 1) : 1;
          }}
          onIndexChange={(i) => setInnerCard((prev) => (prev ? { ...prev, index: i } : prev))}
          onClose={() => setInnerCard(null)}
          onEdit={
            onEditCard
              ? (c) => {
                  setInnerCard(null);
                  onEditCard(c);
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function SlideGrid({
  slots,
  cols,
  rows,
  aspect,
  allocations,
  onTapCard,
}: {
  slots: (EnrichedCard | null)[];
  cols: number;
  rows: number;
  aspect: string;
  allocations: Map<string, AllocationInfo>;
  onTapCard: (card: EnrichedCard) => void;
}) {
  return (
    <div
      className="binder-pages-page"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        aspectRatio: aspect,
      }}
    >
      {slots.map((card, i) => (
        <Cell
          key={i}
          card={card}
          allocation={card ? (allocations.get(card.copyId) ?? null) : null}
          onTap={onTapCard}
        />
      ))}
    </div>
  );
}

function Cell({
  card,
  allocation,
  onTap,
}: {
  card: EnrichedCard | null;
  allocation: AllocationInfo | null;
  onTap: (card: EnrichedCard) => void;
}) {
  if (!card) return <div className="binder-pages-cell empty" />;
  const foilStyle = classifyFoil(card);
  return (
    <button
      type="button"
      className={`binder-pages-cell${card.foil ? ` is-foil foil-${foilStyle}` : ''}${
        allocation ? ' is-allocated' : ''
      }`}
      onClick={() => onTap(card)}
      aria-label={`Open ${card.name}${card.foil ? ' (foil)' : ''}${
        allocation ? ` (in deck: ${allocation.deckName})` : ''
      }`}
    >
      {card.imageNormal ? (
        <CellImage src={card.imageNormal} alt={card.name} />
      ) : (
        <span className="binder-pages-cell-fallback">{card.name}</span>
      )}
      {card.foil && (
        <>
          <div className="card-preview-foil-shine" aria-hidden="true" />
          <div className="card-preview-foil-glare" aria-hidden="true" />
        </>
      )}
      {allocation && (
        <Link
          to={`/decks/${allocation.deckId}`}
          className="slot-deck-badge"
          style={{ '--deck-color': allocation.deckColor || 'var(--accent)' } as React.CSSProperties}
          title={`In deck: ${allocation.deckName}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open deck ${allocation.deckName}`}
        >
          <Layers width={9} height={9} strokeWidth={2.2} aria-hidden />
        </Link>
      )}
    </button>
  );
}

/**
 * Renders one gutter column of index tabs (left or right) for a spread slide.
 * Extracted from the spread map so both gutters share identical logic without
 * duplication (Fix 4). Tab clicks use `block: 'nearest'` for consistency with
 * every other scrollIntoView call in this file (Fix 6). aria-label uses the
 * physical pageNum from pages[] rather than the flat index (Fix 5).
 */
function SpreadTabGutter({
  placements,
  side,
  pages,
  spreads,
  slideRefs,
}: {
  placements: TabPlacement[];
  side: 'left' | 'right';
  pages: BinderPage[];
  spreads: Spread[];
  slideRefs: React.RefObject<Array<HTMLDivElement | null>>;
}) {
  return (
    <div className={`binder-spread-tab-gutter binder-spread-tab-gutter--${side}`}>
      {placements.map((placement) => {
        const physicalPageNum =
          pages[placement.firstPageIndex]?.pageNum ?? placement.firstPageIndex + 1;
        return (
          <button
            key={placement.key}
            type="button"
            className={`binder-spread-tab binder-spread-tab--${side} binder-spread-tab--${placement.variant}${placement.isCurrent ? ' is-current' : ''}`}
            style={{ top: placement.top, height: placement.height }}
            title={placement.label}
            aria-label={`Jump to ${placement.label}, page ${physicalPageNum}`}
            onClick={(e) => {
              e.stopPropagation();
              const targetSpread = spreadIndexForPage(spreads, placement.firstPageIndex);
              if (targetSpread >= 0) {
                slideRefs.current[targetSpread]?.scrollIntoView({
                  inline: 'center',
                  block: 'nearest',
                  behavior: 'smooth',
                });
              }
            }}
          >
            {placement.variant === 'full' ? (
              <>
                {placement.pip && <ColorPip color={placement.key} pip={true} aria-hidden />}
                <span className="binder-spread-tab-label">{placement.label}</span>
              </>
            ) : placement.pip ? (
              <ColorPip color={placement.key} pip={true} aria-hidden />
            ) : (
              <span className="binder-spread-tab-char" aria-hidden="true">
                {placement.label.charAt(0)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Pocket thumbnail with a skeleton placeholder until the art loads — the
// grid analogue of CardPreview's hero skeleton (shared skeleton-shimmer
// keyframe). One image per cell and binder slots are immutable while the
// flipbook is open, so a local boolean is the per-cell equivalent of
// CardPreview's id-keyed imgLoaded map.
function CellImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <div className="binder-pages-cell-skeleton" aria-hidden="true" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        // Cached images can be complete before onLoad attaches — mark
        // loaded on mount so the skeleton doesn't linger forever.
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
