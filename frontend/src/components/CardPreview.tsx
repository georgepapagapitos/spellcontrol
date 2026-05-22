import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  Notebook,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { getSetMap, type SetMap } from '../lib/api';
import { useHolographic } from '../lib/use-holographic';
import { classifyFoil } from '../lib/foil-style';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import type { AllocationInfo } from '../lib/allocations';
import type { BinderInfo } from './BinderBadge';

/** One button in the preview's compact icon bar. Callers supply only
 *  the actions relevant to their view (collection: edit/delete; deck:
 *  edit/delete; etc.), so the bar is view-dependent by construction. */
export interface CardPreviewAction {
  key: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

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
   * Grouped-row quantity for the card at index `i` (collection grid uses
   * this when rows roll up multiple copies of the same printing). Returning
   * <= 1 suppresses the quantity tag.
   */
  getStackQty?: (i: number) => number;
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
  /**
   * View-dependent icon bar. Returns the actions for the card at index
   * `i` (looked up lazily like getStack*). Rendered as a compact icon
   * row next to Flip/Edit; callers pass only what their surface needs.
   */
  getActions?: (i: number) => CardPreviewAction[];
}

const PRELOAD_RADIUS = 2;
// Slides rendered around the focused card while the open animation plays.
// The sheet-rise is a 0.5s compositor transform; mounting the full slide list
// in the same commit (a collection preview can be thousands of cards) stutters
// it. Render a small window first, then expand to the full list once the rise
// has finished — see the `renderAll` expansion effect below.
const INITIAL_RENDER_RADIUS = 8;

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
  getStackQty,
  getActions,
  onIndexChange,
  onClose,
  onEdit,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [selected, setSelected] = useState(index);
  // Slides rendered during the open animation; expands to the full list once
  // the rise settles (see the renderAll effect). Captured once at mount via a
  // lazy initializer — the setter is intentionally unused.
  const [initialWindow] = useState(() => ({
    lo: Math.max(0, index - INITIAL_RENDER_RADIUS),
    hi: index + INITIAL_RENDER_RADIUS,
  }));
  const [renderAll, setRenderAll] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  // Per-card art-loaded flag. Drives the skeleton→image cross-fade so the
  // hero image lands gracefully under the sheet's rise animation instead
  // of popping in. Keyed by scryfallId since slides stay mounted.
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({});
  const markLoaded = useCallback((id: string) => {
    setImgLoaded((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);
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

  // Expanding the slide list (renderAll) inserts slides to the LEFT of the
  // focused card, shifting it off-center. Re-center instantly, before paint,
  // so the expansion is invisible.
  useLayoutEffect(() => {
    if (!renderAll) return;
    slideRefs.current[selected]?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: 'instant' as ScrollBehavior,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderAll]);

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
    // renderAll changes the rendered slide set — re-run so the observer picks
    // up the slides mounted by the post-rise expansion.
    [cards, renderAll]
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

  // Symmetric exit: every dismiss path plays sheet-fall, then unmounts.
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        beginClose();
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
  }, [beginClose, selected, cards.length]);

  const { isDragging, axisLockRef, touchHandlers } = useSwipeDownDismiss({
    onDismiss: beginClose,
    sheetRef,
    trackRef,
  });

  // The drag offset is applied imperatively to the sheet by the hook. Once the
  // gesture ends (isDragging false) and we're not mid-dismiss, clear that
  // inline transform: `is-dragging` is gone, so the sheet's CSS transition is
  // live and animates the snap-back to rest. A dismiss leaves the transform
  // alone — the sheet-fall keyframe continues from where the finger let go.
  useLayoutEffect(() => {
    if (isDragging || isClosing) return;
    const sheet = sheetRef.current;
    if (sheet) sheet.style.transform = '';
  }, [isDragging, isClosing]);

  // Tilt + cursor tracking applies to every card; the foil overlay is the
  // only thing gated to foil cards (handled in CSS via the .is-foil class).
  // Suppress tilt while a touch swipe gesture is in flight — once the parent's
  // axis lock commits to either 'h' (carousel) or 'v' (dismiss), letting the
  // card tilt at the same time looks noisy.
  const holoRef = useHolographic(true, {
    shouldSuppressTilt: () => axisLockRef.current !== null,
  });

  // Once the sheet-rise (0.5s) has played, mount the rest of the slides so
  // keyboard / button navigation and far swipes can reach the whole list.
  // Gated on an idle sheet: mounting the full slide list is a heavy reconcile,
  // and firing it mid-gesture stutters the swipe-down dismiss. While the user
  // is dragging (or the sheet is closing) the timer is held; it (re)starts
  // 600ms after the sheet goes idle, so the expansion always lands in a quiet
  // moment — never during the rise and never during a drag.
  useEffect(() => {
    if (renderAll || isDragging || isClosing) return;
    const t = window.setTimeout(() => setRenderAll(true), 600);
    return () => window.clearTimeout(t);
  }, [renderAll, isDragging, isClosing]);

  // Slide list lifted into a memo so a `dragY` re-render — useSwipeDownDismiss
  // fires setDragY on every touchmove during a dismiss drag — reuses these
  // elements instead of rebuilding one DOM subtree per card. For a large
  // collection that per-frame rebuild is what made the dismiss drag choppy.
  // Recomputes only when something the slides actually depend on changes.
  const slideEls = useMemo(
    () =>
      cards.map((c, i) => {
        // During the open animation only a window around the focused card is
        // rendered; the rest mount once `renderAll` flips post-rise. Gate
        // first so off-window cards skip all per-slide work.
        const inWindow = renderAll || (i >= initialWindow.lo && i <= initialWindow.hi);
        if (!inWindow) return null;
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
                beginClose();
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
                      <>
                        {!imgLoaded[c.scryfallId] && (
                          <div className="card-preview-image-skeleton" aria-hidden="true" />
                        )}
                        <img
                          // Hero drawer can grow to ~620px on desktop;
                          // `large` (672w) stays sharp there where
                          // `normal` (488w) would upscale. Falls back to
                          // normal for cards enriched before imageLarge
                          // existed. Grids/thumbnails keep using normal.
                          src={c.imageLarge || c.imageNormal}
                          alt={c.name}
                          className="card-preview-image"
                          draggable={false}
                          // All slides decode async: a synchronous
                          // decode of the ~672×936 hero (a different,
                          // usually-uncached URL than the grid's normal
                          // art) lands mid-rise and stutters it. Let the
                          // skeleton→image cross-fade cover the arrival
                          // instead — that's what it's built for.
                          decoding="async"
                          loading={i === selected ? 'eager' : 'lazy'}
                          fetchPriority={i === selected ? 'high' : 'auto'}
                          // Cached images may already be complete before
                          // onLoad can attach — mark them loaded on mount
                          // so the skeleton doesn't linger forever.
                          ref={(el) => {
                            if (el?.complete && el.naturalWidth > 0) markLoaded(c.scryfallId);
                          }}
                          onLoad={() => markLoaded(c.scryfallId)}
                          onError={() =>
                            setImgErrors((prev) => ({ ...prev, [c.scryfallId]: true }))
                          }
                        />
                      </>
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
                        src={c.imageLargeBack || c.imageNormalBack}
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
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, mounted, selected, imgErrors, imgLoaded, flipped, renderAll]
  );

  if (!cards[selected]) return null;
  const current = cards[selected];

  return (
    <div
      className={`card-preview-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={() => beginClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={sheetRef}
        className={`card-preview-sheet${isDragging ? ' is-dragging' : ''}${
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
          {slideEls}
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
          {getActions?.(selected).map((a) => (
            <button
              key={a.key}
              type="button"
              className={`card-preview-flip-btn${a.danger ? ' is-danger' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick();
              }}
              aria-label={a.label}
              title={a.label}
            >
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
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
                const sectionLabel = sectionLabels[selected] ?? '';

                return (
                  <>
                    {sectionLabel && ` · ${sectionLabel}`}
                    {uniqueBinders.length > 0 && ' · '}
                    {uniqueBinders.map((b, i) => (
                      <span key={`b-${b.id}`}>
                        {i > 0 && ' · '}
                        <Link
                          to={`/collection/binders/${b.id}`}
                          className="card-preview-context-pill card-preview-context-pill--binder"
                          style={
                            {
                              '--pill-color': b.color || 'var(--accent)',
                            } as React.CSSProperties
                          }
                          onClick={onClose}
                          title={`Open binder ${b.name}`}
                        >
                          <Notebook width={11} height={11} strokeWidth={2.2} aria-hidden />
                          <span>{b.name}</span>
                        </Link>
                      </span>
                    ))}
                    {uniqueDecks.length > 0 && ' · '}
                    {uniqueDecks.map((d, i) => (
                      <span key={`d-${d.deckId}`}>
                        {i > 0 && ' · '}
                        <Link
                          to={`/decks/${d.deckId}`}
                          className="card-preview-context-pill card-preview-context-pill--deck"
                          style={
                            {
                              '--pill-color': d.deckColor || 'var(--accent)',
                            } as React.CSSProperties
                          }
                          onClick={onClose}
                          title={`Open deck ${d.deckName}`}
                        >
                          <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
                          <span>{d.deckName}</span>
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
              {(() => {
                const qty = getStackQty?.(selected) ?? 1;
                return qty > 1 ? (
                  <span className="card-preview-qty" aria-label={`${qty} copies`}>
                    {' · '}
                    <span className="card-preview-qty-x" aria-hidden>
                      ×
                    </span>
                    {qty}
                  </span>
                ) : null;
              })()}
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
