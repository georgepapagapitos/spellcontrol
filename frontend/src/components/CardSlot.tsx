import { useState, useEffect } from 'react';
import type { EnrichedCard } from '../types';
import { getColorKey } from '../lib/colors';

interface Props {
  card: EnrichedCard | null;
}

export function CardSlot({ card }: Props) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [card?.imageNormal]);

  useEffect(() => {
    if (!hovered) return;
    const handler = (e: MouseEvent) => {
      const tipWidth = 230;
      const tipHeight = card?.imageNormal && !imgError ? 320 : 80;
      let x = e.clientX + 14;
      let y = e.clientY - 10;
      if (x + tipWidth > window.innerWidth) x = e.clientX - tipWidth - 10;
      if (y + tipHeight > window.innerHeight) y = e.clientY - tipHeight - 10;
      setPos({ x, y });
    };
    window.addEventListener('mousemove', handler);
    return () => window.removeEventListener('mousemove', handler);
  }, [hovered, card, imgError]);

  if (!card) return <div className="slot empty" />;

  const cls = getSlotClass(card);
  const shortName = card.name.substring(0, 10);

  return (
    <>
      <div
        className={`slot ${cls}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {shortName}
      </div>
      {hovered && (
        <div className="tooltip" style={{ left: pos.x, top: pos.y }}>
          <div className="tooltip-name">{card.name}</div>
          <div className="tooltip-meta">
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
          {card.imageNormal && !imgError && (
            <img
              src={card.imageNormal}
              alt={card.name}
              className="tooltip-image"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          )}
          {card.imageNormal && imgError && (
            <div className="tooltip-img-fallback">Image unavailable</div>
          )}
        </div>
      )}
    </>
  );
}

function getSlotClass(card: EnrichedCard): string {
  if (getColorKey(card) === 'L') return 'land';
  return card.rarity.toLowerCase() || 'common';
}
