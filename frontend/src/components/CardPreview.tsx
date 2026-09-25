import {
  Boxes,
  ChevronUp,
  ExternalLink,
  Layers,
  Notebook,
  Pencil,
  Loader2,
  RefreshCw,
  RotateCw,
  Share2,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { toast } from '../store/toasts';
import type { EnrichedCard } from '../types';
import { CardRulings } from './CardRulings';
import { CardText, CardLegalities } from './CardDetails';
import { useCardDetail } from '../lib/use-card-detail';
import { getRoleBadge, multiRoleTitle, rolesForCard } from '../lib/role-badges';
import { getSetMap, type SetMap } from '../lib/api';
import { SLD_CODE, dropsForNumber, useSldDrops } from '../lib/sld-drops';
import { formatMoney } from '../lib/format-money';
import { formatPricedDate } from '../lib/price-freshness';
import { CardImageFrame } from './CardImageFrame';
import { PriceOverrideBadge } from './shared/PriceOverrideBadge';
import { CardShareDialog } from './CardShareDialog';
import { foilFinishLabel } from '../lib/foil-style';
import { LANGUAGE_OPTIONS } from './PrintingPicker';
import { ManaCost } from './ManaCost';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { SnapCarousel, type SnapCarouselHandle } from './SnapCarousel';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useSheetExit } from '../lib/use-sheet-exit';
import type { AllocationInfo } from '../lib/allocations';
import type { BinderInfo } from './BinderBadge';
import { CardName } from '@/components/shared/CardName';

/** Scryfall card UUID — gates the rulings fetch to real printings. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /** Shown instead of `label` only when the row is too narrow for every label
   *  (a 360px phone). `label` stays the button's accessible name and title. */
  shortLabel?: string;
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
   * Suppress every monetary line in the panel — the price, its override badge
   * and the "Prices updated" stamp. For a surface where the card is real but
   * its value is deliberately not the viewer's business: a friend's collection,
   * whose endpoint withholds quantity and price by contract ("contents yes,
   * value no"). Needed rather than simply leaving the field unset, because
   * `formatMoney` renders an unknown price as `—` — exactly the placeholder
   * that ruling refuses.
   */
  hidePrice?: boolean;
  /**
   * Which surface opened the preview. Exposed as `data-source` on the panel so
   * each view can tune its own panel presentation; also documents intent at the
   * call site. The panel always shows its full content (it scrolls when tall),
   * so this no longer gates section visibility.
   */
  source?: CardPreviewSource;
}

/**
 * Can the browser put an image file in a system share sheet? Answered via
 * `canShare`, and an empty probe File is enough to ask. Desktop browsers say
 * no — they get our own share dialog instead.
 */
function canShareFiles(): boolean {
  try {
    const probe = new File([], 'card.jpg', { type: 'image/jpeg' });
    return navigator.canShare?.({ files: [probe] }) ?? false;
  } catch {
    return false;
  }
}

const PRELOAD_RADIUS = 2;
// Turn toggles (degrees) for single-faced layouts printed sideways — one turn
// to read, one turn back upright. Split halves (incl. DSK Rooms) all read at
// the same clockwise 90; aftermath's bottom half reads counterclockwise;
// Kamigawa flip cards read upside down.
const TURN_CYCLE: Record<string, readonly number[]> = {
  split: [0, 90],
  aftermath: [0, -90],
  flip: [0, 180],
};
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
  hidePrice,
  source,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const panelInnerRef = useRef<HTMLDivElement>(null);
  const carousel = useRef<SnapCarouselHandle>(null);
  const [selected, setSelected] = useState(index);

  // The action row holds one line. When its labelled width won't fit, the
  // buttons with universal glyphs (Share, Flip, Turn, Edit) drop their words,
  // a caller action with a `shortLabel` swaps to it, and the row tightens.
  // Details and the other caller actions keep their words: an ambiguous glyph
  // never goes icon-only (STYLE_GUIDE § Toolbars & action rows). Re-measured
  // every render: it is a handful of buttons, and which ones exist changes per
  // card (Flip only on a double-faced one). A hidden full label is absolutely
  // positioned, so it still reports the width it would take back — `need` is
  // always the fully labelled width, whichever mode is showing.
  const actionRowRef = useRef<HTMLDivElement>(null);
  const labelledGap = useRef(0);
  const [actionsCompact, setActionsCompact] = useState(false);
  const fitActions = useCallback(() => {
    const row = actionRowRef.current;
    if (!row) return;
    const cs = getComputedStyle(row);
    const compact = row.classList.contains('is-compact');
    if (!compact) labelledGap.current = parseFloat(cs.columnGap) || 0;
    const buttons = [...row.children] as HTMLElement[];
    let need = labelledGap.current * (buttons.length - 1);
    for (const b of buttons) {
      need += b.offsetWidth;
      const full = compact ? b.querySelector<HTMLElement>(':scope > span:not([data-short])') : null;
      if (!full || getComputedStyle(full).position !== 'absolute') continue;
      const short = b.querySelector<HTMLElement>(':scope > span[data-short]');
      need += short
        ? full.offsetWidth - short.offsetWidth
        : full.offsetWidth + (parseFloat(getComputedStyle(b).columnGap) || 0);
    }
    // `need` is always the labelled width and the padding doesn't change with
    // the mode, so this can't flip back and forth at the boundary.
    const room = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    setActionsCompact(need > room);
  }, []);
  useLayoutEffect(fitActions);
  useEffect(() => {
    const row = actionRowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fitActions);
    ro.observe(row);
    return () => ro.disconnect();
  }, [fitActions]);
  // Compact (image-hero) ↔ expanded (text-hero) panel. Expanded is a fixed
  // taller height applied to every card, so swiping between cards stays
  // height-stable — the card just shrinks via the track's container query.
  // The playtest/online inspector is opened mid-game to read a card, not to
  // look at its art: it leads with rules text and rulings, drops the
  // collection bookkeeping (price, condition, binder/deck pills, the
  // "card N of M" counter), and starts expanded so none of that needs a
  // chevron hunt at the table.
  const isPlaytest = source === 'playtest';
  const [expanded, setExpanded] = useState(isPlaytest);
  // Full Scryfall card for the focused slide — supplies flavor text, P/T, and
  // authoritative legalities that EnrichedCard doesn't carry. Offline-first,
  // cached; oracle text already renders instantly from the EnrichedCard.
  const detail = useCardDetail(cards[selected]?.name);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const imgKey = (c: EnrichedCard) => c.scryfallId || c.copyId;
  // Fetching + staging the full-res art takes a beat on a cold cache; the button
  // shows a spinner and refuses a second tap until the sheet opens.
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Per-card art-loaded flag. Drives the skeleton→image cross-fade so the
  // hero image lands gracefully under the sheet's rise animation instead
  // of popping in. Keyed by scryfallId since slides stay mounted (and the
  // same printing in two slides shares one load). Name-only placeholders
  // (deck drill-downs, cube picks) open with an empty id, so they fall back
  // to their unique copyId — otherwise every placeholder shares key '' and
  // one broken image marks them all "Image unavailable".
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({});
  const markLoaded = useCallback((id: string) => {
    setImgLoaded((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);
  const [setMap, setSetMap] = useState<SetMap | null>(null);
  // Flip/turn are keyed by slide INDEX, not scryfallId — the same printing can
  // appear in multiple slides (and some surfaces synthesize cards without an
  // id), and a shared key would flip/turn every copy at once.
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  // Rotation (degrees) per slide for single-faced sideways layouts. Split/room
  // halves read at opposite 90s, so those cycle upright → right → left; old
  // Kamigawa flip cards just toggle 180.
  const [turned, setTurned] = useState<Record<number, number>>({});

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
  // Keyed by slide INDEX, not scryfallId: name-only placeholders (deck-analysis
  // drill-downs) open with an empty id and get a real one when enrichment
  // swaps the row in — an id-keyed set never learned about the focused slide,
  // so its art stayed blank until a swipe recomputed the set.
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([index]));

  useEffect(() => {
    const expand = () => {
      setMounted((prev) => {
        let changed = false;
        let next = prev;
        for (let j = index - PRELOAD_RADIUS; j <= index + PRELOAD_RADIUS; j++) {
          if (j >= 0 && j < cards.length && !prev.has(j)) {
            if (!changed) {
              next = new Set(prev);
              changed = true;
            }
            next.add(j);
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
    // Only on initial mount — once neighbors are added, the carousel's
    // scroll-derived index takes over for subsequent index changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  const handleIndexChange = useCallback(
    (bestIdx: number) => {
      setSelected(bestIdx);
      onIndexChangeRef.current(bestIdx);

      setMounted((prev) => {
        let changed = false;
        let next = prev;
        for (let j = bestIdx - PRELOAD_RADIUS; j <= bestIdx + PRELOAD_RADIUS; j++) {
          if (j >= 0 && j < cards.length && !prev.has(j)) {
            if (!changed) {
              next = new Set(prev);
              changed = true;
            }
            next.add(j);
          }
        }
        return next;
      });
    },
    [cards.length]
  );

  // Sync parent → carousel if the parent index changes externally.
  useEffect(() => {
    if (index !== selected) carousel.current?.scrollTo(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useLockBodyScroll();
  const sldIndex = useSldDrops();

  // Symmetric exit: every dismiss path plays sheet-fall, then unmounts.
  const { isClosing, beginClose, onAnimationEnd, exitStyle } = useSheetExit(
    onClose,
    'sheet-fall',
    sheetRef
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The share dialog is a layer above us and owns its own Escape.
      if (shareOpen) return;
      if (e.key === 'Escape') {
        // The preview is always the topmost overlay; capture + stop so a host
        // sheet's document-level Escape listener can't also fire and dismiss
        // both layers on one press. Arrow keys live in the carousel.
        e.stopPropagation();
        beginClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [beginClose, shareOpen]);

  const { isDragging, axisLockRef, touchHandlers } = useSwipeDownDismiss({
    onDismiss: beginClose,
    sheetRef,
    trackRef,
    // Only let a downward swipe dismiss when the panel is scrolled to the top;
    // otherwise the gesture scrolls the (taller, expanded) panel content. The
    // panel's own `overflow-y` handles the scroll once we defer to native.
    canStartDrag: () => (panelInnerRef.current?.scrollTop ?? 0) <= 0,
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

  // Only cards near the focus mount the expensive image frame (the carousel
  // windows the rest to bare placeholders) — a few thousand 3D-transformed
  // frames is what crushed the compositor to ~22fps; keeping the rich set
  // small holds 120fps.
  const renderSlide = (i: number) => {
    const c = cards[i];
    return (
      <CardImageFrame
        card={c}
        active={i === selected}
        flipped={!!flipped[i]}
        turn={turned[i] ?? 0}
        mounted={mounted.has(i)}
        imgLoaded={!!imgLoaded[imgKey(c)]}
        imgErrored={!!imgErrors[imgKey(c)]}
        onImgLoad={() => markLoaded(imgKey(c))}
        onImgError={() => setImgErrors((prev) => ({ ...prev, [imgKey(c)]: true }))}
        eager={i === selected}
        shouldSuppressTilt={shouldSuppressTilt}
      />
    );
  };

  if (!cards[selected]) return null;
  const current = cards[selected];

  // Highest-res art for the face on screen — what Share hands off.
  const faceSrc =
    flipped[selected] && current.imageNormalBack
      ? current.imageLargeBack || current.imageNormalBack
      : current.imageLarge || current.imageNormal;

  // Share the image *bytes*, not a link. Native stages the jpg in the app cache
  // dir — the one location the app's FileProvider exposes (res/xml/file_paths.xml)
  // — and hands Share a file:// URI; mobile web hands a File to the Web Share
  // API. Both land the user in the system sheet, recent conversations and all.
  const systemShare = async () => {
    setSharing(true);
    try {
      const filename = `${current.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`;
      const blob = await (await fetch(faceSrc!)).blob();
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      await navigator.share({ files: [file], title: current.name });
    } catch (err) {
      // Dismissing the system sheet rejects (AbortError on web, "Share canceled"
      // on Android) — a cancel is a no-op, not a failure worth a toast.
      const e = err as { name?: string; message?: string };
      if (e?.name === 'AbortError' || e?.message?.toLowerCase().includes('cancel')) return;
      toast.show({ message: "Couldn't share this card image.", tone: 'warn' });
    } finally {
      setSharing(false);
    }
  };

  // Desktop browsers have no system share sheet; they get our own dialog of
  // destinations instead of a silent download.
  const shareCard = () => {
    if (!faceSrc || sharing) return;
    if (canShareFiles()) void systemShare();
    else setShareOpen(true);
  };

  // Which Secret Lair drop this printing came from (E140) — SLD cards only.
  const sldDropLabel =
    current.setCode?.toUpperCase() === SLD_CODE && sldIndex && current.collectorNumber
      ? dropsForNumber(sldIndex, current.collectorNumber)
          .map((d) => d.name)
          .join(' / ')
      : '';

  // Oracle text + rulings. One definition, two homes: the playtest inspector
  // puts it directly under the type line (it's what the card was opened for);
  // every other surface keeps it below the collection facts.
  const rulesBlock = (
    <>
      <CardText card={current} detail={detail} />
      {/* Real Scryfall printings only — placeholder/synthetic ids would 400. */}
      {UUID_RE.test(current.scryfallId) && (
        <CardRulings
          key={current.scryfallId}
          scryfallId={current.scryfallId}
          defaultOpen={isPlaytest}
        />
      )}
    </>
  );

  const turnCycle = current.layout ? TURN_CYCLE[current.layout] : undefined;
  const turnAngle = turned[selected] ?? 0;
  // indexOf(-1) + 1 === 0, so an unknown angle safely resets to the cycle start.
  const nextTurn = turnCycle ? turnCycle[(turnCycle.indexOf(turnAngle) + 1) % turnCycle.length] : 0;
  const nextTurnLabel =
    nextTurn === 0
      ? 'Turn upright'
      : nextTurn === 180
        ? 'Turn upside down'
        : nextTurn === 90
          ? 'Turn right to read'
          : 'Turn left to read';

  // Portaled to <body>: this is a `position: fixed; inset: 0` full-screen modal.
  // When dropped inside an ancestor that establishes a containing block for
  // fixed descendants — e.g. `.deck-bento` (container-type: inline-size), which
  // wraps the Win-conditions panel — the backdrop would otherwise be trapped to
  // that box instead of the viewport. Portaling escapes any such ancestor.
  return createPortal(
    <div
      className={`card-preview-backdrop${isClosing ? ' is-closing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) beginClose();
      }}
      role="presentation"
    >
      <div
        ref={sheetRef}
        className={`card-preview-sheet${isDragging ? ' is-dragging' : ''}${
          isClosing ? ' is-closing' : ''
        }`}
        role="dialog"
        aria-modal="true"
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
        <SnapCarousel
          ref={carousel}
          trackRef={trackRef}
          count={cards.length}
          index={selected}
          onIndexChange={handleIndexChange}
          windowRadius={WINDOW_RADIUS}
          keysEnabled={!shareOpen}
          className="card-preview-track"
          slideClassName="card-preview-slide"
          renderSlide={renderSlide}
          // Tap the active card to close — matches the natural "tap to
          // dismiss" expectation on mobile and desktop alike.
          onSlideClick={(_, isActive) => isActive && beginClose()}
        />

        {/* Always rendered so single-faced and transform cards reserve the
            same vertical space — otherwise navigating between them would
            shift the panel up/down. */}
        <div
          ref={actionRowRef}
          className={`card-preview-flip-row${actionsCompact ? ' is-compact' : ''}`}
        >
          <button
            type="button"
            className={`card-preview-flip-btn card-preview-details-btn${expanded ? ' is-on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-expanded={expanded}
            aria-controls="card-preview-panel-inner"
            aria-label={expanded ? 'Collapse card details' : 'Expand card details'}
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            <ChevronUp
              width={18}
              height={18}
              strokeWidth={2}
              aria-hidden
              className={`card-preview-details-chevron${expanded ? ' is-open' : ''}`}
            />
            <span>Details</span>
          </button>
          {faceSrc && (
            <button
              type="button"
              className="card-preview-flip-btn"
              onClick={(e) => {
                e.stopPropagation();
                shareCard();
              }}
              data-compactable
              aria-label="Share card image"
              title="Share card image"
              disabled={sharing}
              aria-busy={sharing}
            >
              {sharing ? (
                <Loader2 className="card-preview-share-spinner" aria-hidden />
              ) : (
                <Share2 width={18} height={18} strokeWidth={2} aria-hidden />
              )}
              <span>Share</span>
            </button>
          )}
          {current.imageNormalBack && (
            <button
              type="button"
              className="card-preview-flip-btn"
              onClick={() =>
                setFlipped((prev) => ({
                  ...prev,
                  [selected]: !prev[selected],
                }))
              }
              data-compactable
              aria-label={flipped[selected] ? 'Show front face' : 'Show back face'}
              title={flipped[selected] ? 'Show front face' : 'Show back face'}
            >
              <RefreshCw width={20} height={20} strokeWidth={2} aria-hidden />
              <span>Flip</span>
            </button>
          )}
          {turnCycle && (
            <button
              type="button"
              className="card-preview-flip-btn"
              onClick={() => setTurned((prev) => ({ ...prev, [selected]: nextTurn }))}
              data-compactable
              aria-label={nextTurnLabel}
              title={nextTurnLabel}
            >
              <RotateCw width={20} height={20} strokeWidth={2} aria-hidden />
              <span>Turn</span>
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
              data-compactable
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
              data-has-short={a.shortLabel ? '' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick();
              }}
              aria-label={a.label}
              title={a.label}
            >
              {a.icon}
              <span>{a.label}</span>
              {a.shortLabel && (
                <span data-short aria-hidden>
                  {a.shortLabel}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="card-preview-panel" data-source={source} data-expanded={expanded}>
          <div
            className="card-preview-panel-inner"
            id="card-preview-panel-inner"
            ref={panelInnerRef}
          >
            <div className="card-preview-name-row">
              <div className="card-preview-name">
                <CardName card={current} stacked />
              </div>
            </div>
            {(current.typeLine || current.manaCost) && (
              <div className="card-preview-typeline">
                {current.manaCost && (
                  <ManaCost cost={current.manaCost} className="card-preview-mana" />
                )}
                {current.typeLine && <span className="card-preview-type">{current.typeLine}</span>}
                {(() => {
                  // Whole-card stat (single-face only) — pulled up beside the type
                  // line as card identity; DFC per-face P/T stays in CardText.
                  const stat =
                    detail?.power != null && detail?.toughness != null
                      ? `${detail.power}/${detail.toughness}`
                      : detail?.loyalty != null
                        ? `Loyalty ${detail.loyalty}`
                        : null;
                  return stat ? <span className="card-preview-pt">{stat}</span> : null;
                })()}
              </div>
            )}
            {/* Binder / deck / section provenance. Meaningless at a game table,
                where every card is "Playtest · Battlefield". */}
            {!isPlaytest && (
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
                  const cubeById = new Map<string, AllocationInfo>();
                  for (const a of allocs) {
                    if (a.ownerKind === 'cube') {
                      cubeById.set(a.ownerId, a);
                    } else {
                      if (a.deckId === currentDeckId) continue;
                      deckById.set(a.deckId, a);
                    }
                  }
                  const uniqueDecks = [...deckById.values()];
                  const uniqueCubes = [...cubeById.values()];
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
                            to={`/decks/${d.ownerId}`}
                            className="card-preview-context-pill card-preview-context-pill--deck"
                            style={
                              {
                                '--pill-color': d.deckColor || 'var(--accent)',
                              } as React.CSSProperties
                            }
                            onClick={onClose}
                            title={`In deck: ${d.deckName}`}
                            aria-label={`In deck: ${d.deckName}`}
                          >
                            <Layers width={11} height={11} strokeWidth={2.2} aria-hidden />
                            <span>{d.deckName}</span>
                          </Link>
                        </span>
                      ))}
                      {uniqueCubes.length > 0 && ' · '}
                      {uniqueCubes.map((c, i) => (
                        <span key={`c-${c.ownerId}`}>
                          {i > 0 && ' · '}
                          <Link
                            to={`/decks/cube/${c.ownerId}`}
                            className="card-preview-context-pill card-preview-context-pill--cube"
                            style={
                              {
                                '--pill-color': 'var(--cube-color)',
                              } as React.CSSProperties
                            }
                            onClick={onClose}
                            title={`In cube: ${c.ownerName}`}
                            aria-label={`In cube: ${c.ownerName}`}
                          >
                            <Boxes width={11} height={11} strokeWidth={2.2} aria-hidden />
                            <span>{c.ownerName}</span>
                          </Link>
                        </span>
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
            {renderPanelMeta && (
              <div className="card-preview-slot card-preview-slot--meta">
                {renderPanelMeta(selected)}
              </div>
            )}
            {isPlaytest && rulesBlock}
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
              {!hidePrice && !isPlaytest && (
                <>
                  {' · '}
                  {formatMoney(current.purchasePrice)}
                  <PriceOverrideBadge card={current} />
                </>
              )}
              {(() => {
                const qty = isPlaytest ? 1 : (getStackQty?.(selected) ?? 1);
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
              {!isPlaytest && current.condition && (
                <span
                  className="card-preview-condition"
                  aria-label={`Condition ${current.condition}`}
                >
                  {' · '}
                  {current.condition.toUpperCase()}
                </span>
              )}
              {!isPlaytest &&
                current.language &&
                current.language !== 'en' &&
                (() => {
                  const label =
                    LANGUAGE_OPTIONS.find((o) => o.value === current.language)?.label ??
                    current.language.toUpperCase();
                  return (
                    <span className="card-preview-condition" aria-label={`Language ${label}`}>
                      {' · '}
                      {label}
                    </span>
                  );
                })()}
              {(['altered', 'proxy', 'misprint'] as const)
                .filter((flag) => !isPlaytest && current[flag])
                .map((flag) => (
                  <span key={flag} className="card-preview-condition" aria-label={flag}>
                    {' · '}
                    {flag.toUpperCase()}
                  </span>
                ))}
            </div>
            {(() => {
              // Price freshness on demand — the always-on collection "Prices as
              // of" line was retired; the card inspector is one of its homes.
              const updated = hidePrice || isPlaytest ? null : formatPricedDate(current.pricedAt);
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
                  {sldDropLabel ? (
                    <span className="card-preview-set-code"> · {sldDropLabel}</span>
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
              {!isPlaytest && (
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
              )}
            </div>
            {/* Rules-reference depth, below the collection facts — revealed when
                the panel expands (compact height shows the facts first). */}
            {!isPlaytest && rulesBlock}
            <CardLegalities legalities={detail?.legalities ?? current.legalities} />
            {renderPanelExtra && (
              <div className="card-preview-slot">{renderPanelExtra(selected)}</div>
            )}
            {/* Carousel position. A playtest inspector always holds exactly one
                card, so the counter would only ever read "Card 1 of 1". */}
            {!isPlaytest && (
              <div className="card-preview-counter">
                Card {selected + 1} of {cards.length}
                {pageNumbers[selected] ? ` · Page ${pageNumbers[selected]} of ${totalPages}` : ''}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Portaled out of the backdrop's DOM subtree. React still bubbles the
          portal's clicks through the *component* tree to the backdrop above,
          but its handler only dismisses on `e.target === e.currentTarget`,
          which a click anywhere in this dialog never satisfies. */}
      {shareOpen &&
        faceSrc &&
        createPortal(
          <CardShareDialog
            name={current.name}
            imageUrl={faceSrc}
            onClose={() => setShareOpen(false)}
          />,
          document.body
        )}
    </div>,
    document.body
  );
}
