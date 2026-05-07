import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';

interface Props {
  cards: EnrichedCard[];
  index: number;
  binderName: string;
  sectionLabel: string;
  pageNumbers: number[];
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

const PRELOAD_RADIUS = 2;

export function CardPreview({
  cards,
  index,
  binderName,
  sectionLabel,
  pageNumbers,
  onIndexChange,
  onClose,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [selected, setSelected] = useState(index);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

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

  if (!cards[selected]) return null;
  const current = cards[selected];

  return (
    <div className="card-preview-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <button
        className="card-preview-close"
        onClick={onClose}
        aria-label="Close card preview"
        type="button"
      >
        ×
      </button>

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
        <div className="card-preview-name">{current.name}</div>
        <div className="card-preview-context">
          {binderName} · {sectionLabel}
          {pageNumbers[selected] ? ` · p.${pageNumbers[selected]}` : ''}
        </div>
        <div className="card-preview-meta">
          {current.rarity} · ${current.purchasePrice.toFixed(2)}
          {current.cmc !== undefined ? ` · CMC ${current.cmc}` : ''}
          {current.setName || current.setCode ? ` · ${current.setName || current.setCode}` : ''}
          {current.typeLine ? ` · ${current.typeLine}` : ''}
        </div>
        <div className="card-preview-counter">
          {selected + 1} / {cards.length}
        </div>
      </div>
    </div>
  );
}
