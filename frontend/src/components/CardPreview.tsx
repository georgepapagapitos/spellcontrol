import { useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { EnrichedCard } from '../types';

interface Props {
  cards: EnrichedCard[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

export function CardPreview({ cards, index, onIndexChange, onClose }: Props) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex: index,
    align: 'center',
    loop: false,
    skipSnaps: false,
    duration: 22,
    containScroll: 'trimSnaps',
  });
  const [selected, setSelected] = useState(index);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  // Sync embla → parent index.
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const i = emblaApi.selectedScrollSnap();
      setSelected(i);
      onIndexChange(i);
    };
    emblaApi.on('select', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
    };
  }, [emblaApi, onIndexChange]);

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

  const card = cards[selected];
  if (!card) return null;

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

        <div className="card-preview-name">{card.name}</div>
        <div className="card-preview-meta">
          {card.rarity} · ${card.purchasePrice.toFixed(2)}
          {card.cmc !== undefined ? ` · CMC ${card.cmc}` : ''}
          <br />
          {card.setName || card.setCode}
          {card.typeLine ? (
            <>
              <br />
              {card.typeLine}
            </>
          ) : null}
        </div>

        <div className="card-preview-viewport" ref={emblaRef}>
          <div className="card-preview-track">
            {cards.map((c, i) => {
              const errored = imgErrors[c.scryfallId];
              const near = Math.abs(i - selected) <= 1;
              return (
                <div className="card-preview-slide" key={`${c.scryfallId}-${i}`}>
                  <div className="card-preview-image-frame">
                    {c.imageNormal && !errored && near ? (
                      <img
                        src={c.imageNormal}
                        alt={c.name}
                        className="card-preview-image"
                        draggable={false}
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [c.scryfallId]: true }))
                        }
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
