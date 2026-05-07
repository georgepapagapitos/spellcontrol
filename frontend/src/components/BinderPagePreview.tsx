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
  } as React.CSSProperties;

  const currentPage = pages[selected];

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
          <div className="binder-pages-track" ref={trackRef} onClick={(e) => e.stopPropagation()}>
            {pages.map((page, i) => (
              <div
                className={`binder-pages-slide${i === selected ? ' is-active' : ''}`}
                ref={(el) => {
                  slideRefs.current[i] = el;
                }}
                key={`${page.pageNum}-${i}`}
              >
                <PageThumb page={page} pocketSize={pocketSize} onTapCard={handleCardTap} />
              </div>
            ))}
          </div>

          <div className="binder-pages-panel" onClick={(e) => e.stopPropagation()}>
            <div className="binder-pages-name">{binderName}</div>
            <div className="binder-pages-context">
              {pageLabels[selected] ? `${pageLabels[selected]} · ` : ''}page {currentPage?.pageNum}
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

function PageThumb({
  page,
  pocketSize,
  onTapCard,
}: {
  page: BinderPage;
  pocketSize: PocketSize;
  onTapCard: (card: EnrichedCard) => void;
}) {
  if (pocketSize === 18) {
    const front = page.slots.slice(0, 9);
    const back = page.slots.slice(9, 18);
    while (front.length < 9) front.push(null);
    while (back.length < 9) back.push(null);
    return (
      <div className="binder-pages-page page-18">
        <PageSide cards={front} cols={3} onTapCard={onTapCard} />
        <PageSide cards={back} cols={3} onTapCard={onTapCard} />
      </div>
    );
  }
  const cols = pocketSize === 4 ? 2 : 3;
  return (
    <div className="binder-pages-page" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {page.slots.map((card, i) => (
        <Cell key={i} card={card} onTap={onTapCard} />
      ))}
    </div>
  );
}

function PageSide({
  cards,
  cols,
  onTapCard,
}: {
  cards: (EnrichedCard | null)[];
  cols: number;
  onTapCard: (card: EnrichedCard) => void;
}) {
  return (
    <div className="binder-pages-page-side" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {cards.map((card, i) => (
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
