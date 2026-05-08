import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EnrichedCard } from '../types';
import { getSetMap, type SetMap } from '../lib/api';
import { useHolographic } from '../lib/use-holographic';
import { classifyFoil } from '../lib/foil-style';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';
import { useAllocations } from '../lib/allocations';

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
   * Deck the preview is being opened from, if any. When the current card is
   * allocated to this same deck, we suppress the "In deck" chip — repeating
   * the deck name back to the user inside that deck's editor is just noise.
   */
  currentDeckId?: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
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
  onIndexChange,
  onClose,
}: Props) {
  const allocations = useAllocations();
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

  // Mount neighboring images; once mounted, stay mounted to avoid mid-swipe
  // DOM thrash when a new image first appears.
  const [mounted, setMounted] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (let i = 0; i < cards.length; i++) {
      if (Math.abs(i - index) <= PRELOAD_RADIUS) {
        const id = cards[i]?.scryfallId;
        if (id) initial.add(id);
      }
    }
    return initial;
  });

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
              >
                <div
                  className={`card-preview-image-frame${foilClass}`}
                  ref={i === selected ? holoRef : undefined}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className={`card-preview-flipper${flipped[c.scryfallId] ? ' is-flipped' : ''}`}
                  >
                    <div className="card-preview-face card-preview-face-front">
                      {c.imageNormal && !errored && shouldMount ? (
                        <img
                          src={c.imageNormal}
                          alt={c.name}
                          className="card-preview-image"
                          draggable={false}
                          decoding="async"
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
              <FlipIcon />
              <span>Flip</span>
            </button>
          )}
        </div>

        <div className="card-preview-panel" onClick={(e) => e.stopPropagation()}>
          <div className="card-preview-panel-inner">
            <div className="card-preview-name-row">
              <div className="card-preview-name">{current.name}</div>
              {(() => {
                const allocation = allocations.get(current.copyId);
                if (!allocation || allocation.deckId === currentDeckId) return null;
                return (
                  <DeckChip
                    deckId={allocation.deckId}
                    deckName={allocation.deckName}
                    onNavigate={onClose}
                  />
                );
              })()}
            </div>
            <div className="card-preview-context">
              {binderName}
              {sectionLabels[selected] ? ` · ${sectionLabels[selected]}` : ''}
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

function DeckChip({
  deckId,
  deckName,
  onNavigate,
}: {
  deckId: string;
  deckName: string;
  onNavigate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className={`card-preview-deck-chip${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="card-preview-deck-chip-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-label={expanded ? 'Hide deck name' : 'Show deck name'}
        aria-expanded={expanded}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
          className="card-preview-deck-chip-icon"
        >
          <rect x="1" y="4" width="9" height="11" rx="1.5" opacity="0.55" />
          <rect x="3.5" y="2" width="9" height="11" rx="1.5" opacity="0.8" />
          <rect x="6" y="0" width="9" height="11" rx="1.5" />
        </svg>
      </button>
      <Link
        to={`/decks/${deckId}`}
        className="card-preview-deck-chip-link"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate();
        }}
        title={`Open deck ${deckName}`}
      >
        <span className="card-preview-deck-chip-label">In deck</span>
        <span className="card-preview-deck-chip-name">{deckName}</span>
      </Link>
    </span>
  );
}

function FlipIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
