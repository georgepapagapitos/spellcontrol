import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';
import { getSetMap, type SetMap } from '../lib/api';

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

  // Detect which slide is centered. IntersectionObserver with threshold 0.5
  // fires when any slide crosses the halfway-visible mark — exactly the
  // "halfway commits" semantic.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= 0.5) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLDivElement);
            if (idx < 0) continue;
            setSelected(idx);
            onIndexChangeRef.current(idx);

            let added = false;
            for (let j = idx - PRELOAD_RADIUS; j <= idx + PRELOAD_RADIUS; j++) {
              const id = cards[j]?.scryfallId;
              if (id && !mountedRef.current.has(id)) {
                mountedRef.current.add(id);
                added = true;
              }
            }
            if (added) forceRender((n) => n + 1);
          }
        }
      },
      { root: track, threshold: [0.5] }
    );
    slideRefs.current.forEach((s) => s && observer.observe(s));
    return () => observer.disconnect();
  }, [cards]);

  // Sync parent → carousel if the parent index changes externally.
  useEffect(() => {
    if (index === selected) return;
    const slide = slideRefs.current[index];
    if (slide) {
      slide.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Lock body scroll while the preview is open so swipe-down (or any other
  // touch motion) can't bleed through and scroll the page behind.
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

  // Swipe-down-to-dismiss. Track vertical drag on the sheet; axis-lock on
  // first significant move so horizontal swipes inside the carousel still
  // drive the native scroll-snap. Up swipes are intentionally ignored.
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const axisLockRef = useRef<'h' | 'v' | null>(null);
  // When the gesture locks vertical, pin the carousel's horizontal scroll
  // position so any sideways finger motion during the dismiss drag can't
  // also flip cards.
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
      // Only respond to downward drag; ignore upward.
      setDragY(Math.max(0, dy));
      // Pin horizontal scroll so the carousel can't change cards mid-dismiss.
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
    // Dismiss if dragged far enough OR flicked down hard.
    if (dy > 120 || velocity > 0.6) {
      onClose();
    } else {
      setDragY(0);
    }
  };

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
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="card-preview-track" ref={trackRef} onClick={(e) => e.stopPropagation()}>
          {cards.map((c, i) => {
            const errored = imgErrors[c.scryfallId];
            const shouldMount = mountedRef.current.has(c.scryfallId);
            return (
              <div
                className="card-preview-slide"
                ref={(el) => {
                  slideRefs.current[i] = el;
                }}
                key={`${c.scryfallId}-${i}`}
              >
                <div className="card-preview-image-frame">
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
