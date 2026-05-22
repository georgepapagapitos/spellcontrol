import { forwardRef } from 'react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Pure presentational card face — image / face-down back / placeholder plus
 * counters. Shared by the draggable `PlaytestCardView` and the top-level
 * `DragOverlay` copy so both render identically without duplicating markup.
 */
export const PlaytestCardFace = forwardRef<HTMLDivElement, Props>(function PlaytestCardFace(
  { card, bf, size = 'md', className = '', ...rest },
  ref
) {
  const tapped = bf?.tapped ?? false;
  const faceDown = bf?.faceDown ?? false;
  const counters = bf?.counters ?? {};

  return (
    <div
      ref={ref}
      className={`playtest-card playtest-card--${size}${tapped ? ' playtest-card--tapped' : ''}${
        className ? ` ${className}` : ''
      }`}
      {...rest}
    >
      {faceDown ? (
        <div className="playtest-card__back" aria-label="Face-down card" />
      ) : card.imageUrl ? (
        <img src={card.imageUrl} alt={card.name} draggable={false} />
      ) : (
        <div className="playtest-card__placeholder">{card.name}</div>
      )}
      {Object.entries(counters).length > 0 && (
        <div className="playtest-card__counters">
          {Object.entries(counters).map(([k, v]) => (
            <span key={k} className="playtest-card__counter" title={k}>
              {k === '+1/+1' ? '+1' : k.slice(0, 3)}:{v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
