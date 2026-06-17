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
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { getRoleBadge, multiRoleTitle, rolesForCard } from '../lib/role-badges';
import { getSetMap, type SetMap } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { formatPricedDate } from '../lib/price-freshness';
import { CardImageFrame } from './CardImageFrame';
import { foilFinishLabel } from '../lib/foil-style';
import { ManaCost } from './ManaCost';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useMaxBoundaryScroll } from '../lib/use-max-boundary-scroll';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import type { AllocationInfo } from '../lib/allocations';
import type { BinderInfo } from './BinderBadge';

/** Which surface opened the preview. Drives per-context panel content
 *  (exposed as `data-source` on the panel for context-specific styling). */
export type CardPreviewSource =
  | 'deck'
  | 'collection'
  | 'binder'
  | 'suggestion'
  | 'search'
  | 'playtest';

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
  /**
   * When set, show the card's deck role (Ramp / Removal / …) spelled out
   * in the detail panel. Opt-in so it only appears in the deck view,
   * where roles are meaningful — not in collection/binder previews.
   */
  showRole?: boolean;
  /**
   * Optional extra content injected into the detail panel for the card at
   * index `i` (rendered below the external links, above the counter). The
   * Scryfall search preview uses this to host its inline printing/finish
   * picker; collection/binder/deck previews leave it unset. Clicks inside
   * are already shielded from the sheet's tap-to-dismiss by the panel.
   */
  renderPanelExtra?: (i: number) => ReactNode;
  /**
   * Optional high-placed content for the card at index `i`, rendered near the
   * top of the panel (just under the context line, above price/set/links) so
   * it reads before the boilerplate. The deck view uses this to surface
   * partner/role/synergy/inclusion context; other surfaces leave it unset.
   * CardPreview stays context-agnostic — it only renders the slot.
   */
  renderPanelMeta?: (i: number) => ReactNode;
  /**
   * Which surface opened the preview. Exposed as `data-source` on the panel so
   * each view can tune its own panel presentation; also documents intent at the
   * call site. The panel always shows its full content (it scrolls when tall),
   * so this no longer gates section visibility.
   */
  source?: CardPreviewSource;
}

const PRELOAD_RADIUS = 2;
// Window of cards that get a *rich* slide (the 3D-transformed, box-shadowed
// image frame). Every card still gets a bare placeholder div so the scroll
// track keeps its full width and native scroll-snap is unaffected — but only
// slides within WINDOW_RADIUS of the focused card mount the expensive frame.
// Measured on-device: a few thousand rich frames drop the sheet to ~22fps;
// keeping the rich set small holds 120fps. The window follows the focus.
const WINDOW_RADIUS = 12;

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
  showRole,
  renderPanelExtra,
  renderPanelMeta,
  source,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [selected, setSelected] = useState(index);
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
    // Every card always has a placeholder slide div, so the observed set is
    // stable for the life of the carousel — only `cards` identity matters.
    [cards]
  );

  // Clamp the native scroll so a momentum fling can't rubber-band past the
  // first/last card (CSS overscroll-behavior alone doesn't fully cover the
  // Capacitor WebView — see the hook).
  useMaxBoundaryScroll(trackRef);

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
  // card tilt at the same time looks noisy. Each CardImageFrame owns its own
  // holographic hook (enabled only for the focused slide); this stable getter
  // feeds them the swipe-gesture suppression signal.
  const shouldSuppressTilt = useCallback(() => axisLockRef.current !== null, [axisLockRef]);

  // Slide list lifted into a memo so a re-render (e.g. the once-per-gesture
  // isDragging toggle) reuses these elements instead of rebuilding one DOM
  // subtree per card. Recomputes only when something the slides depend on
  // changes — notably `selected`, which slides the rich-content window.
  const slideEls = useMemo(
    () =>
      cards.map((c, i) => {
        // Every card always renders a bare placeholder slide div: that keeps
        // the scroll track full-width and native scroll-snap intact. Only
        // cards within WINDOW_RADIUS of the focus mount the expensive image
        // frame — a few thousand 3D-transformed frames is what crushed the
        // compositor to ~22fps; keeping the rich set small holds 120fps.
        const inWindow = Math.abs(i - selected) <= WINDOW_RADIUS;
        const slideRef = (el: HTMLDivElement | null) => {
          slideRefs.current[i] = el;
        };
        const onSlideClick = (e: React.MouseEvent) => {
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
        };
        if (!inWindow) {
          // Placeholder: holds the slide's width/scroll-snap slot, nothing else.
          return (
            <div
              className="card-preview-slide"
              ref={slideRef}
              key={`${c.scryfallId}-${i}`}
              onClick={onSlideClick}
            />
          );
        }
        return (
          <div
            className={`card-preview-slide${i === selected ? ' is-active' : ''}`}
            ref={slideRef}
            key={`${c.scryfallId}-${i}`}
            onClick={onSlideClick}
          >
            <CardImageFrame
              card={c}
              active={i === selected}
              flipped={!!flipped[c.scryfallId]}
              mounted={mounted.has(c.scryfallId)}
              imgLoaded={!!imgLoaded[c.scryfallId]}
              imgErrored={!!imgErrors[c.scryfallId]}
              onImgLoad={() => markLoaded(c.scryfallId)}
              onImgError={() => setImgErrors((prev) => ({ ...prev, [c.scryfallId]: true }))}
              eager={i === selected}
              shouldSuppressTilt={shouldSuppressTilt}
            />
          </div>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, mounted, selected, imgErrors, imgLoaded, flipped]
  );

  if (!cards[selected]) return null;
  const current = cards[selected];

  // Portaled to <body>: this is a `position: fixed; inset: 0` full-screen modal.
  // When dropped inside an ancestor that establishes a containing block for
  // fixed descendants — e.g. `.deck-bento` (container-type: inline-size), which
  // wraps the Win-conditions panel — the backdrop would otherwise be trapped to
  // that box instead of the viewport. Portaling escapes any such ancestor.
  return createPortal(
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

        <div
          className="card-preview-panel"
          data-source={source}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="card-preview-panel-inner">
            <div className="card-preview-name-row">
              <div className="card-preview-name">{current.name}</div>
            </div>
            {(current.typeLine || current.manaCost) && (
              <div className="card-preview-typeline">
                {current.manaCost && (
                  <ManaCost cost={current.manaCost} className="card-preview-mana" />
                )}
                {current.typeLine && <span className="card-preview-type">{current.typeLine}</span>}
              </div>
            )}
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
            {renderPanelMeta && (
              <div className="card-preview-slot card-preview-slot--meta">
                {renderPanelMeta(selected)}
              </div>
            )}
            <div className="card-preview-meta">
              <span
                className={`card-preview-rarity rarity-${(current.rarity || '').toLowerCase()}`}
              >
                {current.rarity}
              </span>
              {(() => {
                // One finish token, as specific as the data allows — "Etched",
                // "Oil slick", … — falling back to plain "Foil". Labels come
                // from the shared FoilBadge mapping so wording never drifts.
                const finish = foilFinishLabel(current);
                return finish ? <span className="card-preview-foil">{finish}</span> : null;
              })()}
              {' · '}
              {formatMoney(current.purchasePrice)}
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
              {current.condition && (
                <span
                  className="card-preview-condition"
                  aria-label={`Condition ${current.condition}`}
                >
                  {' · '}
                  {current.condition.toUpperCase()}
                </span>
              )}
            </div>
            {(() => {
              // Price freshness on demand — the always-on collection "Prices as
              // of" line was retired; the card inspector is one of its homes.
              const updated = formatPricedDate(current.pricedAt);
              return updated ? (
                <div className="card-preview-priced-at">Prices updated {updated}</div>
              ) : null;
            })()}
            {showRole &&
              (() => {
                // Role decodes from the card name via the bundled tagger,
                // so the preview needs no extra data plumbing.
                const badge = getRoleBadge({ name: current.name });
                if (!badge) return null;
                const roleText =
                  rolesForCard({ name: current.name }).length > 1
                    ? multiRoleTitle({ name: current.name })
                    : badge.title;
                return (
                  <div className="card-preview-role">
                    <span className={`deck-row-role-badge deck-row-role-${badge.tone}`} aria-hidden>
                      {badge.label}
                    </span>
                    <span>{roleText}</span>
                  </div>
                );
              })()}
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
                  {current.collectorNumber ? (
                    // Collector number completes the printing identity — it's
                    // what disambiguates two otherwise-identical rows.
                    <span className="card-preview-set-code"> · #{current.collectorNumber}</span>
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
            {renderPanelExtra && (
              <div className="card-preview-slot">{renderPanelExtra(selected)}</div>
            )}
            <div className="card-preview-counter">
              Card {selected + 1} of {cards.length}
              {pageNumbers[selected] ? ` · Page ${pageNumbers[selected]} of ${totalPages}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
  // The layer occupies the same grid cell as the card track (see CSS), so the
  // arrows center in the card area above the panel — and ride up as that area
  // shrinks when the panel expands — instead of pinning to mid-screen and
  // colliding with the expanded panel.
  return (
    <div className="carousel-nav-layer">
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
    </div>
  );
}
