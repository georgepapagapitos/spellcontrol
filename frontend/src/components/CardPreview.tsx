import { ChevronLeft, ChevronRight, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { getSetMap, type SetMap } from '../lib/api';
import { useHolographic } from '../lib/use-holographic';
import { classifyFoil } from '../lib/foil-style';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import type { AllocationInfo } from '../lib/allocations';
import type { BinderInfo } from './BinderBadge';

interface Props {
  cards: EnrichedCard[];
  index: number;
  binderName: string;
  /** Section label per card (parallel to `cards`). Updates as the user navigates across sections. */
  sectionLabels: string[];
  /** Page number per card (parallel to `cards`). */
  pageNumbers: number[];
  /** Total number of pages in the scope these cards belong to. */
  totalPages: number;
  /**
   * Aggregated binders covering every copy in the row at index `i`. Looked
   * up lazily by the carousel — building a parallel array up front would
   * cost O(rows) per render even though only the focused row is rendered.
   */
  getStackBinders?: (i: number) => BinderInfo[];
  /**
   * Aggregated deck allocations for every copy in the row at index `i`.
   * Each unique deck renders as a link in the context line; `currentDeckId`
   * is filtered so the preview doesn't link back to the deck it was opened
   * from.
   */
  getStackAllocations?: (i: number) => AllocationInfo[];
  /**
   * Deck the preview is being opened from, if any. When the current card is
   * allocated to this same deck, we suppress the "In deck" chip — repeating
   * the deck name back to the user inside that deck's editor is just noise.
   */
  currentDeckId?: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /**
   * When provided, an Edit button is rendered alongside Flip. The parent is
   * expected to dismiss the carousel and open its own CardEditDialog — we
   * avoid stacking two scroll-locking modals.
   */
  onEdit?: (card: EnrichedCard) => void;
}

const PRELOAD_RADIUS = 2;

export function CardPreview({
  cards,
  index,
  binderName,
  sectionLabels,
  pageNumbers,
  totalPages,
  currentDeckId,
  getStackBinders,
  getStackAllocations,
  onIndexChange,
  onClose,
  onEdit,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [selected, setSelected] = useState(index);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [setMap, setSetMap] = useState<SetMap | null>(null);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setSetMap(m);
      })
      .catch(() => {
        /* fall back to text-only set line */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mount the focused slide synchronously so the first paint already shows
  // the card the user clicked. Neighbors fill in on the next tick — they're
  // only needed for swipe peeks, and deferring them buys a faster open.
  // Once mounted, slides stay mounted to avoid mid-swipe DOM thrash.
  const [mounted, setMounted] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const id = cards[index]?.scryfallId;
    if (id) initial.add(id);
    return initial;
  });

  useEffect(() => {
    const expand = () => {
      setMounted((prev) => {
        let changed = false;
        let next = prev;
        for (let j = index - PRELOAD_RADIUS; j <= index + PRELOAD_RADIUS; j++) {
          const id = cards[j]?.scryfallId;
          if (id && !prev.has(id)) {
            if (!changed) {
              next = new Set(prev);
              changed = true;
            }
            next.add(id);
          }
        }
        return next;
      });
    };
    // requestIdleCallback when available, otherwise a microtask via setTimeout(0)
    // — either way runs after the first paint.
    const ric = (window as unknown as { requestIdleCallback?: typeof requestIdleCallback })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      const handle = ric(expand);
      return () =>
        (
          window as unknown as { cancelIdleCallback?: typeof cancelIdleCallback }
        ).cancelIdleCallback?.(handle);
    }
    const t = window.setTimeout(expand, 0);
    return () => window.clearTimeout(t);
    // Only on initial mount — once neighbors are added, useCenteredSlide
    // takes over for subsequent index changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  // Initial scroll: jump to the requested slide without animation.
  useLayoutEffect(() => {
    const slide = slideRefs.current[index];
    if (slide) {
      slide.scrollIntoView({
        inline: 'center',
        block: 'nearest',
        behavior: 'instant' as ScrollBehavior,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCenteredSlide(
    trackRef,
    slideRefs,
    (bestIdx) => {
      setSelected(bestIdx);
      onIndexChangeRef.current(bestIdx);

      setMounted((prev) => {
        let changed = false;
        let next = prev;
        for (let j = bestIdx - PRELOAD_RADIUS; j <= bestIdx + PRELOAD_RADIUS; j++) {
          const id = cards[j]?.scryfallId;
          if (id && !prev.has(id)) {
            if (!changed) {
              next = new Set(prev);
              changed = true;
            }
            next.add(id);
          }
        }
        return next;
      });
    },
    [cards]
  );

  // Sync parent → carousel if the parent index changes externally.
  useEffect(() => {
    if (index === selected) return;
    const slide = slideRefs.current[index];
    if (slide) {
      slide.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      let next: number | null = null;
      if (e.key === 'ArrowLeft') next = Math.max(0, selected - 1);
      else if (e.key === 'ArrowRight') next = Math.min(cards.length - 1, selected + 1);
      if (next === null || next === selected) return;
      const slide = slideRefs.current[next];
      slide?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selected, cards.length]);

  const { dragY, isDragging, axisLockRef, touchHandlers } = useSwipeDownDismiss({
    onDismiss: onClose,
    trackRef,
  });

  // Tilt + cursor tracking applies to every card; the foil overlay is the
  // only thing gated to foil cards (handled in CSS via the .is-foil class).
  // Suppress tilt while a touch swipe gesture is in flight — once the parent's
  // axis lock commits to either 'h' (carousel) or 'v' (dismiss), letting the
  // card tilt at the same time looks noisy.
  const holoRef = useHolographic(true, {
    shouldSuppressTilt: () => axisLockRef.current !== null,
  });

  if (!cards[selected]) return null;
  const current = cards[selected];

  const dim = Math.max(0, 1 - dragY / 400);
  const sheetStyle = {
    transform: `translateY(${dragY}px)`,
  } as React.CSSProperties;
  const backdropStyle = {
    backgroundColor: `rgba(0, 0, 0, ${0.72 * dim})`,
  } as React.CSSProperties;

  return (
    <div
      className="card-preview-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={backdropStyle}
    >
      <div
        className={`card-preview-sheet${isDragging ? ' is-dragging' : ''}`}
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
        {cards.length > 1 && (
          <CarouselNav
            onPrev={() => {
              const next = Math.max(0, selected - 1);
              if (next !== selected)
                slideRefs.current[next]?.scrollIntoView({
                  inline: 'center',
                  block: 'nearest',
                  behavior: 'smooth',
                });
            }}
            onNext={() => {
              const next = Math.min(cards.length - 1, selected + 1);
              if (next !== selected)
                slideRefs.current[next]?.scrollIntoView({
                  inline: 'center',
                  block: 'nearest',
                  behavior: 'smooth',
                });
            }}
            atStart={selected === 0}
            atEnd={selected === cards.length - 1}
          />
        )}
        <div className="card-preview-track" ref={trackRef}>
          {cards.map((c, i) => {
            const errored = imgErrors[c.scryfallId];
            const shouldMount = mounted.has(c.scryfallId);
            const style = classifyFoil(c);
            const foilClass = style !== 'none' ? ` is-foil foil-${style}` : '';
            return (
              <div
                className={`card-preview-slide${i === selected ? ' is-active' : ''}`}
                ref={(el) => {
                  slideRefs.current[i] = el;
                }}
                key={`${c.scryfallId}-${i}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (i !== selected) {
                    // Tap a peeking neighbor to advance to it.
                    slideRefs.current[i]?.scrollIntoView({
                      inline: 'center',
                      block: 'nearest',
                      behavior: 'smooth',
                    });
                  } else {
                    // Tap the active card to close — matches the natural
                    // "tap to dismiss" expectation on mobile and desktop alike.
                    onClose();
                  }
                }}
              >
                <div
                  className={`card-preview-image-frame${foilClass}`}
                  ref={i === selected ? holoRef : undefined}
                >
                  {shouldMount && (
                    <div
                      className={`card-preview-flipper${flipped[c.scryfallId] ? ' is-flipped' : ''}`}
                    >
                      <div className="card-preview-face card-preview-face-front">
                        {c.imageNormal && !errored ? (
                          <img
                            src={c.imageNormal}
                            alt={c.name}
                            className="card-preview-image"
                            draggable={false}
                            decoding={i === selected ? 'sync' : 'async'}
                            loading={i === selected ? 'eager' : 'lazy'}
                            fetchPriority={i === selected ? 'high' : 'auto'}
                            onError={() =>
                              setImgErrors((prev) => ({ ...prev, [c.scryfallId]: true }))
                            }
                          />
                        ) : c.imageNormal && errored ? (
                          <div className="card-preview-image-fallback">Image unavailable</div>
                        ) : null}
                        {c.foil && (
                          <>
                            <div className="card-preview-foil-shine" aria-hidden="true" />
                            <div className="card-preview-foil-glare" aria-hidden="true" />
                          </>
                        )}
                      </div>
                      {c.imageNormalBack && (
                        <div className="card-preview-face card-preview-face-back">
                          <img
                            src={c.imageNormalBack}
                            alt={`${c.name} (back)`}
                            className="card-preview-image"
                            draggable={false}
                            decoding="async"
                          />
                          {c.foil && (
                            <>
                              <div className="card-preview-foil-shine" aria-hidden="true" />
                              <div className="card-preview-foil-glare" aria-hidden="true" />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Always rendered so single-faced and transform cards reserve the
            same vertical space — otherwise navigating between them would
            shift the panel up/down. */}
        <div className="card-preview-flip-row" onClick={(e) => e.stopPropagation()}>
          {current.imageNormalBack && (
            <button
              type="button"
              className="card-preview-flip-btn"
              onClick={() =>
                setFlipped((prev) => ({
                  ...prev,
                  [current.scryfallId]: !prev[current.scryfallId],
                }))
              }
              aria-label={flipped[current.scryfallId] ? 'Show front face' : 'Show back face'}
              title={flipped[current.scryfallId] ? 'Show front face' : 'Show back face'}
            >
              <RefreshCw width={20} height={20} strokeWidth={2} aria-hidden />
              <span>Flip</span>
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className="card-preview-flip-btn"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(current);
              }}
              aria-label="Edit printing"
              title="Edit printing"
            >
              <Pencil width={18} height={18} strokeWidth={2} aria-hidden />
              <span>Edit</span>
            </button>
          )}
        </div>

        <div className="card-preview-panel" onClick={(e) => e.stopPropagation()}>
          <div className="card-preview-panel-inner">
            <div className="card-preview-name-row">
              <div className="card-preview-name">{current.name}</div>
            </div>
            <div className="card-preview-context">
              {binderName}
              {(() => {
                // Aggregate binders and decks across every copy in the stack
                // so a grouped row can surface every container it touches —
                // not just whichever copy the row picked as its representative.
                const binders = getStackBinders?.(selected) ?? [];
                const binderById = new Map<string, BinderInfo>();
                for (const b of binders) binderById.set(b.id, b);
                const uniqueBinders = [...binderById.values()];

                const allocs = getStackAllocations?.(selected) ?? [];
                const deckById = new Map<string, AllocationInfo>();
                for (const a of allocs) {
                  if (a.deckId === currentDeckId) continue;
                  deckById.set(a.deckId, a);
                }
                const uniqueDecks = [...deckById.values()];

                const hasAny = uniqueBinders.length > 0 || uniqueDecks.length > 0;
                if (!hasAny) {
                  return sectionLabels[selected] ? ` · ${sectionLabels[selected]}` : '';
                }
                return (
                  <>
                    {uniqueBinders.length > 0 && ' · '}
                    {uniqueBinders.map((b, i) => (
                      <span key={`b-${b.id}`}>
                        {i > 0 && ', '}
                        <Link
                          to={`/binders/${b.id}`}
                          className="card-preview-context-link"
                          style={
                            {
                              '--binder-color': b.color || 'var(--accent)',
                            } as React.CSSProperties
                          }
                          onClick={onClose}
                          title={`Open binder ${b.name}`}
                        >
                          {b.name}
                        </Link>
                      </span>
                    ))}
                    {uniqueDecks.length > 0 && ' · '}
                    {uniqueDecks.map((d, i) => (
                      <span key={`d-${d.deckId}`}>
                        {i > 0 && ', '}
                        <Link
                          to={`/decks/${d.deckId}`}
                          className="card-preview-context-link card-preview-context-link--deck"
                          onClick={onClose}
                          title={`Open deck ${d.deckName}`}
                        >
                          {d.deckName}
                        </Link>
                      </span>
                    ))}
                  </>
                );
              })()}
            </div>
            <div className="card-preview-meta">
              <span
                className={`card-preview-rarity rarity-${(current.rarity || '').toLowerCase()}`}
              >
                {current.rarity}
              </span>
              {current.foil && <span className="card-preview-foil">foil</span>}
              {' · '}${current.purchasePrice.toFixed(2)}
            </div>
            <div className="card-preview-set">
              {current.setCode && setMap?.[current.setCode.toUpperCase()]?.iconSvgUri ? (
                <img
                  src={setMap[current.setCode.toUpperCase()].iconSvgUri}
                  alt=""
                  aria-hidden="true"
                  className="card-preview-set-icon"
                />
              ) : null}
              {(current.setName || current.setCode) && (
                <span>
                  {current.setName || current.setCode}
                  {current.setName && current.setCode ? (
                    <span className="card-preview-set-code">
                      {' '}
                      ({current.setCode.toUpperCase()})
                    </span>
                  ) : null}
                </span>
              )}
            </div>
            <div className="card-preview-links">
              <a
                href={`https://scryfall.com/card/${current.setCode.toLowerCase()}/${current.collectorNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="card-preview-ext-link"
              >
                Scryfall
                <ExternalLink
                  width={12}
                  height={12}
                  strokeWidth={2.4}
                  aria-hidden
                  className="card-preview-ext-link-icon"
                />
              </a>
              <a
                href={`https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(current.name)}&view=grid`}
                target="_blank"
                rel="noopener noreferrer"
                className="card-preview-ext-link"
              >
                TCGPlayer
                <ExternalLink
                  width={12}
                  height={12}
                  strokeWidth={2.4}
                  aria-hidden
                  className="card-preview-ext-link-icon"
                />
              </a>
            </div>
            <div className="card-preview-counter">
              Card {selected + 1} of {cards.length}
              {pageNumbers[selected] ? ` · Page ${pageNumbers[selected]} of ${totalPages}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CarouselNav({
  onPrev,
  onNext,
  atStart,
  atEnd,
}: {
  onPrev: () => void;
  onNext: () => void;
  atStart: boolean;
  atEnd: boolean;
}) {
  return (
    <>
      <button
        type="button"
        className="carousel-nav carousel-nav-prev"
        onClick={(e) => {
          e.stopPropagation();
          onPrev();
        }}
        disabled={atStart}
        aria-label="Previous"
      >
        <ChevronLeft width={20} height={20} strokeWidth={2.4} aria-hidden />
      </button>
      <button
        type="button"
        className="carousel-nav carousel-nav-next"
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
        disabled={atEnd}
        aria-label="Next"
      >
        <ChevronRight width={20} height={20} strokeWidth={2.4} aria-hidden />
      </button>
    </>
  );
}
