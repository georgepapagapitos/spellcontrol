import { useEffect, useRef, useState } from 'react';
import type { EnrichedCard } from '../types';

interface Props {
  cards: EnrichedCard[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 50;

export function CardPreview({ cards, index, onIndexChange, onClose }: Props) {
  const card = cards[index];
  const [imgError, setImgError] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    setImgError(false);
  }, [card?.scryfallId]);

  // Keyboard navigation: arrow keys + ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && index < cards.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, cards.length, onIndexChange, onClose]);

  if (!card) return null;

  const hasPrev = index > 0;
  const hasNext = index < cards.length - 1;
  const goPrev = () => hasPrev && onIndexChange(index - 1);
  const goNext = () => hasNext && onIndexChange(index + 1);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Horizontal swipe wins only if it dominates vertical movement.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  return (
    <div className="card-preview-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="card-preview"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
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

        {card.imageNormal && !imgError ? (
          <img
            src={card.imageNormal}
            alt={card.name}
            className="card-preview-image"
            onError={() => setImgError(true)}
          />
        ) : card.imageNormal && imgError ? (
          <div className="card-preview-image-fallback">Image unavailable</div>
        ) : null}

        <div className="card-preview-counter">
          {index + 1} / {cards.length}
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
