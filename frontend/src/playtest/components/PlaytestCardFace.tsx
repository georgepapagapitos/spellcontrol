import { forwardRef, memo, useState } from 'react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  size?: 'sm' | 'md' | 'lg';
}

const MAX_VISIBLE_STICKERS = 3;

/**
 * Pure presentational card face — image / face-down back / placeholder plus
 * counters. Shared by the draggable `PlaytestCardView` and the top-level
 * `DragOverlay` copy so both render identically without duplicating markup.
 */
export const PlaytestCardFace = memo(
  forwardRef<HTMLDivElement, Props>(function PlaytestCardFace(
    { card, bf, size = 'md', className = '', ...rest },
    ref
  ) {
    const tapped = bf?.tapped ?? false;
    const faceDown = bf?.faceDown ?? false;
    const counters = bf?.counters ?? {};
    const stickers = bf?.stickers ?? [];
    // A broken/slow image degrades to the same text placeholder used for
    // cards with no imageUrl at all — never a broken-image glyph. Resets
    // whenever the underlying image changes (e.g. a new card lands here).
    const [imgError, setImgError] = useState(false);

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
        ) : card.imageUrl && !imgError ? (
          <img
            src={card.imageUrl}
            alt={card.name}
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="playtest-card__placeholder">{card.name}</div>
        )}
        {stickers.length > 0 && (
          <div className="playtest-card__stickers">
            {/* Cap the visible stack: the smallest card tier (100px) fits ~4
              badges before .playtest-card's overflow:hidden silently clips.
              The rest roll up into a +N chip; the full list lives in the
              card context menu (where removal already is). */}
            {stickers.slice(0, MAX_VISIBLE_STICKERS).map((s, i) => (
              <span key={`${i}-${s}`} className="playtest-card__sticker" title={s}>
                {s}
              </span>
            ))}
            {stickers.length > MAX_VISIBLE_STICKERS && (
              <span
                className="playtest-card__sticker"
                title={stickers.slice(MAX_VISIBLE_STICKERS).join(', ')}
              >
                +{stickers.length - MAX_VISIBLE_STICKERS} more
              </span>
            )}
          </div>
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
  })
);
