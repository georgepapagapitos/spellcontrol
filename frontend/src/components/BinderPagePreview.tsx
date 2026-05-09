import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import { CardPreview } from './CardPreview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';

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
}

export function BinderPagePreview({
  pages,
  pageLabels,
  startPageIndex,
  pocketSize,
  binderName,
  resolveCard,
  onClose,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
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

  // Keyboard nav.
  useEffect(() => {
    if (innerCard) return; // let CardPreview own keys while it's open
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
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
  }, [onClose, selected, pages.length, innerCard]);

  const { dragY, isDragging, touchHandlers } = useSwipeDownDismiss({
    onDismiss: onClose,
    trackRef,
  });

  const handleCardTap = (card: EnrichedCard) => {
    const scope = resolveCard(card);
    if (scope) setInnerCard(scope);
  };

  if (pages.length === 0) return null;

  const dim = Math.max(0, 1 - dragY / 400);
  const sheetStyle = { transform: `translateY(${dragY}px)` } as React.CSSProperties;
  const backdropStyle = {
    backgroundColor: `rgba(0, 0, 0, ${0.72 * dim})`,
    ['--page-w-ratio' as string]: pageAspectRatio,
  } as React.CSSProperties;

  const currentPage = pages[selected];
  const currentLabel = pageLabels[selected] ?? '';

  return (
    <>
      <div
        className="binder-pages-backdrop"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        style={backdropStyle}
      >
        <div
          className={`binder-pages-sheet${isDragging ? ' is-dragging' : ''}`}
          style={sheetStyle}
          {...touchHandlers}
        >
          <button
            type="button"
            className="card-preview-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
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
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
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
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </>
          )}
          <div className="binder-pages-track" ref={trackRef}>
            {pages.map((page, i) => (
              <div
                className={`binder-pages-slide${i === selected ? ' is-active' : ''}`}
                ref={(el) => {
                  slideRefs.current[i] = el;
                }}
                key={`${page.pageNum}-${i}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="binder-pages-slide-label">page {page.pageNum}</div>
                <SlideGrid
                  slots={page.slots}
                  cols={cols}
                  rows={rows}
                  aspect={slideAspect}
                  onTapCard={handleCardTap}
                />
              </div>
            ))}
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
          onIndexChange={(i) => setInnerCard((prev) => (prev ? { ...prev, index: i } : prev))}
          onClose={() => setInnerCard(null)}
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
  onTapCard,
}: {
  slots: (EnrichedCard | null)[];
  cols: number;
  rows: number;
  aspect: string;
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
        <Cell key={i} card={card} onTap={onTapCard} />
      ))}
    </div>
  );
}

function Cell({ card, onTap }: { card: EnrichedCard | null; onTap: (card: EnrichedCard) => void }) {
  if (!card) return <div className="binder-pages-cell empty" />;
  return (
    <button
      type="button"
      className={`binder-pages-cell${card.foil ? ' is-foil' : ''}`}
      onClick={() => onTap(card)}
      aria-label={`Open ${card.name}${card.foil ? ' (foil)' : ''}`}
    >
      {card.imageNormal ? (
        <img
          src={card.imageNormal}
          alt={card.name}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : (
        <span className="binder-pages-cell-fallback">{card.name}</span>
      )}
    </button>
  );
}
