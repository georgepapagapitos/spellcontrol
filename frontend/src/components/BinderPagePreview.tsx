import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import { CardPreview } from './CardPreview';

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
  // sync as the user swipes through cards in the inner CardPreview.
  const cardToPageIndex = useMemo(() => {
    const m = new Map<EnrichedCard, number>();
    pages.forEach((p, i) => {
      p.slots.forEach((slot) => {
        if (slot && !m.has(slot)) m.set(slot, i);
      });
    });
    return m;
  }, [pages]);

  // When the user swipes inside the inner CardPreview, slide the background
  // flipbook to whichever page contains the now-current card.
  useEffect(() => {
    if (!innerCard) return;
    const card = innerCard.cards[innerCard.index];
    if (!card) return;
    const target = cardToPageIndex.get(card);
    if (target === undefined || target === selected) return;
    slideRefs.current[target]?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
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

  // Detect centered page via IntersectionObserver — same pattern as CardPreview.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.5) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (idx >= 0) setSelected(idx);
          }
        }
      },
      { root: track, threshold: [0.5] }
    );
    slideRefs.current.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
  }, [pages]);

  // Lock body scroll while open.
  useEffect(() => {
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

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

  // Swipe-down-to-dismiss (mirrors CardPreview).
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const axisLockRef = useRef<'h' | 'v' | null>(null);
  const lockedScrollLeftRef = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    dragStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    axisLockRef.current = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = dragStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (axisLockRef.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLockRef.current = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
        if (axisLockRef.current === 'v') setIsDragging(true);
      }
    }
    if (axisLockRef.current === 'v') {
      setDragY(Math.max(0, dy));
      const track = trackRef.current;
      if (track) {
        if (lockedScrollLeftRef.current === null) {
          lockedScrollLeftRef.current = track.scrollLeft;
        }
        track.scrollLeft = lockedScrollLeftRef.current;
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    setIsDragging(false);
    if (!start || axisLockRef.current !== 'v') {
      setDragY(0);
      axisLockRef.current = null;
      lockedScrollLeftRef.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const dy = t.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.t);
    const velocity = dy / dt;
    axisLockRef.current = null;
    lockedScrollLeftRef.current = null;
    if (dy > 120 || velocity > 0.6) {
      onClose();
    } else {
      setDragY(0);
    }
  };

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
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
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
                className="binder-pages-slide"
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
      className="binder-pages-cell"
      onClick={() => onTap(card)}
      aria-label={`Open ${card.name}`}
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
