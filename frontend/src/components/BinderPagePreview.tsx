import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import { CardPreview } from './CardPreview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useAllocations, type AllocationInfo } from '../lib/allocations';

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
}

// Pages within this many slides of the focus mount their full pocket grid;
// the rest render as bare placeholder slides that hold the scroll slot only.
// Mirrors CardPreview's windowing — keeps the carousel light on large binders
// without disturbing native scroll-snap (every page keeps a sized slide div).
const PAGE_WINDOW_RADIUS = 5;

export function BinderPagePreview({
  pages,
  pageLabels,
  startPageIndex,
  pocketSize,
  binderName,
  resolveCard,
  onClose,
  onEditCard,
  qtyByCopyId,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);

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

  const [selected, setSelected] = useState(startPageIndex);
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
    const target = cardToPageIndex.get(card);
    if (target === undefined || target === selected) return;
    slideRefs.current[target]?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'instant' as ScrollBehavior,
    });
  }, [innerCard, cardToPageIndex, selected]);

  // Initial scroll: jump to the requested page without animation.
  useLayoutEffect(() => {
    const slide = slideRefs.current[startPageIndex];
    if (slide) {
      slide.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCenteredSlide(trackRef, slideRefs, setSelected, [pages]);

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
      else if (e.key === 'ArrowRight') next = Math.min(pages.length - 1, selected + 1);
      if (next === null || next === selected) return;
      slideRefs.current[next]?.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'smooth',
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beginClose, selected, pages.length, innerCard]);

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

  const handleCardTap = (card: EnrichedCard) => {
    const scope = resolveCard(card);
    if (scope) setInnerCard(scope);
  };

  if (pages.length === 0) return null;

  // Same model as CardPreview: the sheet is a transparent transform carrier
  // (only the opaque binder page + info panel rise); the dim sits on the
  // backdrop, which stays put, fades in/out (.is-closing), and carries the
  // sizing var (--page-w-ratio drives --slide-size).
  const backdropStyle = {
    ['--page-w-ratio' as string]: pageAspectRatio,
  } as React.CSSProperties;

  const currentPage = pages[selected];
  const currentLabel = pageLabels[selected] ?? '';

  return (
    <>
      <div
        className={`binder-pages-backdrop${isClosing ? ' is-closing' : ''}`}
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
          {pages.length > 1 && (
            <>
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
                aria-label="Previous page"
              >
                <ChevronLeft width={20} height={20} strokeWidth={2.4} aria-hidden />
              </button>
              <button
                type="button"
                className="carousel-nav carousel-nav-next"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = Math.min(pages.length - 1, selected + 1);
                  if (next !== selected)
                    slideRefs.current[next]?.scrollIntoView({
                      inline: 'center',
                      block: 'nearest',
                      behavior: 'smooth',
                    });
                }}
                disabled={selected === pages.length - 1}
                aria-label="Next page"
              >
                <ChevronRight width={20} height={20} strokeWidth={2.4} aria-hidden />
              </button>
            </>
          )}
          <div className="binder-pages-track" ref={trackRef}>
            {pages.map((page, i) => {
              const slideRef = (el: HTMLDivElement | null) => {
                slideRefs.current[i] = el;
              };
              // Out-of-window pages render a bare placeholder: it keeps the
              // slide's width/scroll-snap slot so native scrolling is intact,
              // but skips the pocket grid (cols×rows cells) — a few thousand
              // cells mounted at once is what would jank a large binder.
              if (Math.abs(i - selected) > PAGE_WINDOW_RADIUS) {
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
                  <div className="binder-pages-slide-label">page {page.pageNum}</div>
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
            <div className="binder-pages-context">
              {currentLabel ? `${currentLabel} · ` : ''}page {currentPage?.pageNum}
            </div>
            <div className="binder-pages-counter">
              Page {selected + 1} of {pages.length}
            </div>
          </div>
        </div>
      </div>

      {innerCard && (
        <CardPreview
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
  return (
    <button
      type="button"
      className={`binder-pages-cell${card.foil ? ' is-foil' : ''}${
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
