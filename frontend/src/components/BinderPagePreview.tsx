import { Boxes, Layers, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BinderPage, EnrichedCard, PocketSize } from '../types';
import { CardPreview, type CardPreviewAction } from './CardPreview';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { SnapCarousel, type SnapCarouselHandle } from './SnapCarousel';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import { useAllocations, type AllocationInfo } from '../lib/allocations';
import { classifyFoil } from '../lib/foil-style';
import { IconButton } from '@/components/shared/Button';
import { FoilShimmer } from '@/components/shared/FoilShimmer';

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
  /** Extra per-card actions (e.g. "Set cover") forwarded to the inner CardPreview's icon bar. */
  getCardActions?: (card: EnrichedCard | undefined) => CardPreviewAction[];
  /** Group-printings qty by copyId — forwarded to inner CardPreview's ×N tag. */
  qtyByCopyId?: Map<string, number>;
}

// Pages within this many slides of the focus mount their full pocket grid;
// the rest render as bare placeholder slides that hold the scroll slot only.
// Mirrors CardPreview's windowing — keeps the carousel light on large binders
// without disturbing native scroll-snap (every page keeps a sized slide div).
const PAGE_WINDOW_RADIUS = 5;

/** Clicks on these are clicks on empty space — they close the page viewer. */
function isEmptySpace(el: EventTarget): boolean {
  return (
    el instanceof HTMLElement &&
    (el.classList.contains('binder-pages-backdrop') ||
      el.classList.contains('binder-pages-stage') ||
      el.classList.contains('binder-pages-track') ||
      el.classList.contains('binder-pages-topbar'))
  );
}

export function BinderPagePreview({
  pages,
  pageLabels,
  startPageIndex,
  pocketSize,
  binderName,
  resolveCard,
  onClose,
  onEditCard,
  getCardActions,
  qtyByCopyId,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const carousel = useRef<SnapCarouselHandle>(null);

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
    const targetPage = cardToPageIndex.get(card);
    if (targetPage === undefined || targetPage === selected) return;
    carousel.current?.scrollTo(targetPage, 'instant');
  }, [innerCard, cardToPageIndex, selected]);

  useLockBodyScroll();

  // Symmetric exit: every flipbook dismiss path plays sheet-fall, then
  // unmounts — same treatment as the inner CardPreview.
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(onClose);

  // Escape closes; arrow keys live in the carousel (off while CardPreview owns them).
  useEffect(() => {
    if (innerCard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') beginClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [beginClose, innerCard]);

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
  // page shape (--page-w-ratio drives --bp-page-w).
  const backdropStyle = { ['--page-w-ratio' as string]: pageAspectRatio } as React.CSSProperties;

  // Where this page sits (the top bar) and what's on it (the panel), each said
  // once. A search leaves only matching pages, so the physical page number and
  // the position in this run diverge; say both only then.
  const current = pages[selected];
  const unfiltered = pages[pages.length - 1]?.pageNum === pages.length;
  const where = unfiltered
    ? `Page ${current?.pageNum} of ${pages.length}`
    : `Page ${current?.pageNum} · ${selected + 1} of ${pages.length} shown`;
  const currentLabel = pageLabels[selected] ?? '';

  return (
    <>
      <div
        className={`binder-pages-backdrop${isClosing ? ' is-closing' : ''}`}
        // Empty space closes — the backdrop, the stage around the page, the
        // gaps between pages, the top bar (as in CardPreview). A pocket opens
        // its card; nothing in the panel is empty space.
        onClick={(e) => {
          e.stopPropagation();
          if (isEmptySpace(e.target)) beginClose();
        }}
        role="presentation"
        style={backdropStyle}
      >
        <div
          ref={sheetRef}
          className={`binder-pages-sheet${isDragging ? ' is-dragging' : ''}${
            isClosing ? ' is-closing' : ''
          }`}
          role="dialog"
          aria-modal="true"
          aria-label={`${binderName} pages`}
          style={exitStyle}
          onAnimationEnd={onAnimationEnd}
          {...touchHandlers}
        >
          <IconButton
            className="card-preview-close"
            onClick={(e) => {
              e.stopPropagation();
              beginClose();
            }}
            label="Close pages"
            icon={<X width={20} height={20} strokeWidth={2} />}
          />
          <div className="binder-pages-stage">
            <div className="binder-pages-topbar">
              <span className="binder-pages-pos">{where}</span>
              <span className="card-preview-grabber" aria-hidden="true" />
            </div>
            <SnapCarousel
              ref={carousel}
              trackRef={trackRef}
              count={pages.length}
              index={selected}
              onIndexChange={setSelected}
              windowRadius={PAGE_WINDOW_RADIUS}
              keysEnabled={!innerCard}
              className="binder-pages-track"
              prevLabel="Previous page"
              nextLabel="Next page"
              slideClassName="binder-pages-slide"
              renderSlide={(i) => (
                <SlideGrid
                  slots={pages[i].slots}
                  cols={cols}
                  rows={rows}
                  aspect={slideAspect}
                  allocations={allocations}
                  onTapCard={handleCardTap}
                />
              )}
            />
          </div>

          {/* A fixed-height panel: its text wraps or clips inside it and can
              never size the layout (a long section line once widened the
              whole sheet and pushed the page off-screen). */}
          <div className="binder-pages-panel">
            <div className="binder-pages-name">{binderName}</div>
            <div className="binder-pages-context">{currentLabel}</div>
            {pages.length > 2 && (
              // Jump anywhere in a long binder without swiping page by page.
              // Its own touches never reach the sheet's swipe-down dismiss.
              <input
                type="range"
                className="binder-pages-scrubber"
                min={0}
                max={pages.length - 1}
                value={selected}
                aria-label="Page"
                aria-valuetext={where}
                onChange={(e) => carousel.current?.scrollTo(Number(e.target.value), 'instant')}
                onTouchStart={(e) => e.stopPropagation()}
              />
            )}
          </div>
          <div className="sr-only" aria-live="polite">
            {currentLabel ? `${where}, ${currentLabel}` : where}
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
          getActions={getCardActions ? (i) => getCardActions(innerCard.cards[i]) : undefined}
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
        allocation
          ? ` (in ${allocation.ownerKind === 'cube' ? 'cube' : 'deck'}: ${allocation.ownerName})`
          : ''
      }`}
    >
      {card.imageNormal ? (
        <CellImage src={card.imageNormal} alt={card.name} />
      ) : (
        <span className="binder-pages-cell-fallback">{card.name}</span>
      )}
      {card.foil && <FoilShimmer seed={card.copyId} />}
      {allocation && (
        <Link
          to={
            allocation.ownerKind === 'cube'
              ? `/decks/cube/${allocation.ownerId}`
              : `/decks/${allocation.ownerId}`
          }
          className="slot-deck-badge"
          style={
            {
              '--deck-color':
                allocation.ownerKind === 'cube'
                  ? 'var(--cube-color)'
                  : allocation.ownerColor || 'var(--accent)',
            } as React.CSSProperties
          }
          title={`In ${allocation.ownerKind === 'cube' ? 'cube' : 'deck'}: ${allocation.ownerName}`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${allocation.ownerKind === 'cube' ? 'cube' : 'deck'} ${allocation.ownerName}`}
        >
          {allocation.ownerKind === 'cube' ? (
            <Boxes width={9} height={9} strokeWidth={2.2} aria-hidden />
          ) : (
            <Layers width={9} height={9} strokeWidth={2.2} aria-hidden />
          )}
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
