import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';
import { getSetMap, type SetMap } from '../lib/api';
import { useHolographic } from '../lib/use-holographic';
import { classifyFoil } from '../lib/foil-style';
import { useLockBodyScroll } from '../lib/use-lock-body-scroll';
import { useCenteredSlide } from '../lib/use-centered-slide';
import { useSwipeDownDismiss } from '../lib/use-swipe-down-dismiss';

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
  onIndexChange,
  onClose,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [selected, setSelected] = useState(index);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [setMap, setSetMap] = useState<SetMap | null>(null);

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
  const mountedRef = useRef<Set<string>>(new Set());
  if (mountedRef.current.size === 0) {
    for (let i = 0; i < cards.length; i++) {
      if (Math.abs(i - index) <= PRELOAD_RADIUS) {
        const id = cards[i]?.scryfallId;
        if (id) mountedRef.current.add(id);
      }
    }
  }
  const [, forceRender] = useState(0);

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

      let added = false;
      for (let j = bestIdx - PRELOAD_RADIUS; j <= bestIdx + PRELOAD_RADIUS; j++) {
        const id = cards[j]?.scryfallId;
        if (id && !mountedRef.current.has(id)) {
          mountedRef.current.add(id);
          added = true;
        }
      }
      if (added) forceRender((n) => n + 1);
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
        <div className="card-preview-track" ref={trackRef} onClick={(e) => e.stopPropagation()}>
          {cards.map((c, i) => {
            const errored = imgErrors[c.scryfallId];
            const shouldMount = mountedRef.current.has(c.scryfallId);
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
                >
                  {c.imageNormal && !errored && shouldMount ? (
                    <img
                      src={c.imageNormal}
                      alt={c.name}
                      className="card-preview-image"
                      draggable={false}
                      decoding="async"
                      onError={() => setImgErrors((prev) => ({ ...prev, [c.scryfallId]: true }))}
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
              </div>
            );
          })}
        </div>

        <div className="card-preview-panel" onClick={(e) => e.stopPropagation()}>
          <div className="card-preview-panel-inner">
            <div className="card-preview-name">{current.name}</div>
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
            {(current.setName || current.setCode) && (
              <div className="card-preview-set">
                {current.setCode && setMap?.[current.setCode.toUpperCase()]?.iconSvgUri ? (
                  <img
                    src={setMap[current.setCode.toUpperCase()].iconSvgUri}
                    alt=""
                    aria-hidden="true"
                    className="card-preview-set-icon"
                  />
                ) : null}
                <span>
                  {current.setName || current.setCode}
                  {current.setName && current.setCode ? (
                    <span className="card-preview-set-code">
                      {' '}
                      ({current.setCode.toUpperCase()})
                    </span>
                  ) : null}
                </span>
              </div>
            )}
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
