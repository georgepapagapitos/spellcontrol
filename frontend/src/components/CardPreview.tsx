import { useCallback, useEffect, useRef, useState } from 'react';
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
    loop: false,
    skipSnaps: true,
    duration: 18,
    containScroll: 'trimSnaps',
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
  // Bump this whenever we add to the mount set so render reflects it.
  const [, forceRender] = useState(0);

  // Stable callback ref so the embla listener doesn't re-register on each
  // parent render (which causes mid-snap stutter).
  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  // Sync embla → parent index, and grow the mount set as we approach new cards.
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
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
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, cards]);

  // Sync parent index → embla (e.g. arrow buttons or external changes).
  useEffect(() => {
    if (!emblaApi) return;
    if (emblaApi.selectedScrollSnap() !== index) {
      emblaApi.scrollTo(index);
    }
  }, [emblaApi, index]);

  // Keyboard navigation: arrow keys + ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') emblaApi?.scrollPrev();
      else if (e.key === 'ArrowRight') emblaApi?.scrollNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emblaApi, onClose]);

  const goPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const goNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  if (!cards[selected]) return null;

  const hasPrev = selected > 0;
  const hasNext = selected < cards.length - 1;

  return (
    <div className="card-preview-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card-preview" onClick={(e) => e.stopPropagation()}>
        <button
          className="card-preview-close"
          onClick={onClose}
          aria-label="Close card preview"
          type="button"
        >
          ×
        </button>

        <div className="card-preview-context">
          {binderName} · {sectionLabel}
          {pageNumbers[selected] ? ` · p.${pageNumbers[selected]}` : ''}
        </div>

        <div className="card-preview-viewport" ref={emblaRef}>
          <div className="card-preview-track">
            {cards.map((c, i) => {
              const errored = imgErrors[c.scryfallId];
              const shouldMount = mountedRef.current.has(c.scryfallId);
              return (
                <div className="card-preview-slide" key={`${c.scryfallId}-${i}`}>
                  <div className="card-preview-name">{c.name}</div>
                  <div className="card-preview-meta">
                    {c.rarity} · ${c.purchasePrice.toFixed(2)}
                    {c.cmc !== undefined ? ` · CMC ${c.cmc}` : ''}
                    <br />
                    {c.setName || c.setCode}
                    {c.typeLine ? (
                      <>
                        <br />
                        {c.typeLine}
                      </>
                    ) : null}
                  </div>
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

        <div className="card-preview-counter">
          {selected + 1} / {cards.length}
        </div>

        <button
          className="card-preview-nav prev"
          onClick={goPrev}
          disabled={!hasPrev}
          aria-label="Previous card"
          type="button"
        >
          ‹
        </button>
        <button
          className="card-preview-nav next"
          onClick={goNext}
          disabled={!hasNext}
          aria-label="Next card"
          type="button"
        >
          ›
        </button>
      </div>
    </div>
  );
}
