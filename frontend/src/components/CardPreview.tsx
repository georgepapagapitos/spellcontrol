import { useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
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
  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex: index,
    align: 'center',
    containScroll: false,
  });
  const [selected, setSelected] = useState(index);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  // Track which images have ever been mounted; once mounted, stay mounted to
  // avoid DOM thrash mid-swipe.
  const mountedRef = useRef<Set<string>>(new Set());
  const initialMountedIds = useRef<string[]>([]);
  if (initialMountedIds.current.length === 0) {
    for (let i = 0; i < cards.length; i++) {
      if (Math.abs(i - index) <= PRELOAD_RADIUS) {
        const id = cards[i]?.scryfallId;
        if (id) {
          mountedRef.current.add(id);
          initialMountedIds.current.push(id);
        }
      }
    }
  }
  const [, forceRender] = useState(0);

  // Stable callback ref so the embla listener doesn't re-register on each
  // parent render (which causes mid-snap stutter).
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  useEffect(() => {
    if (!emblaApi) return;
    // Mount neighboring images on pointerDown so they're decoded *before* the
    // snap animation runs. Notify React (panel + parent) on settle, after the
    // animation completes — running setState mid-RAF drops frames and reads
    // as a "jerk" on release.
    const onPointerDown = () => {
      const i = emblaApi.selectedScrollSnap();
      let added = false;
      for (let j = i - PRELOAD_RADIUS - 1; j <= i + PRELOAD_RADIUS + 1; j++) {
        const id = cards[j]?.scryfallId;
        if (id && !mountedRef.current.has(id)) {
          mountedRef.current.add(id);
          added = true;
        }
      }
      if (added) forceRender((n) => n + 1);
    };
    const onSettle = () => {
      const i = emblaApi.selectedScrollSnap();
      setSelected(i);
      onIndexChangeRef.current(i);

      let added = false;
      for (let j = i - PRELOAD_RADIUS; j <= i + PRELOAD_RADIUS; j++) {
        const id = cards[j]?.scryfallId;
        if (id && !mountedRef.current.has(id)) {
          mountedRef.current.add(id);
          added = true;
        }
      }
      if (added) forceRender((n) => n + 1);
    };
    emblaApi.on('pointerDown', onPointerDown);
    emblaApi.on('settle', onSettle);
    return () => {
      emblaApi.off('pointerDown', onPointerDown);
      emblaApi.off('settle', onSettle);
    };
  }, [emblaApi, cards]);

  useEffect(() => {
    if (!emblaApi) return;
    if (emblaApi.selectedScrollSnap() !== index) {
      emblaApi.scrollTo(index);
    }
  }, [emblaApi, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') emblaApi?.scrollPrev();
      else if (e.key === 'ArrowRight') emblaApi?.scrollNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emblaApi, onClose]);

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

      <div className="card-preview-carousel" ref={emblaRef} onClick={(e) => e.stopPropagation()}>
        <div className="card-preview-track">
          {cards.map((c, i) => {
            const errored = imgErrors[c.scryfallId];
            const shouldMount = mountedRef.current.has(c.scryfallId);
            return (
              <div className="card-preview-slide" key={`${c.scryfallId}-${i}`}>
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
