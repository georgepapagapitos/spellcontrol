import { forwardRef, memo, useEffect, useState } from 'react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { displayPT } from '../lib/power-toughness';
import { CardCounters } from './CardCounters';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  size?: 'sm' | 'md' | 'lg';
  /** Hides the read-only power/toughness box — the battlefield renders
   *  editable badges beside the card instead (see `CardPtBadges`). */
  ptHidden?: boolean;
  /** Hides the counters drawn inside the card — the battlefield draws
   *  clickable ones beside it instead (see `CardCounters`). */
  countersHidden?: boolean;
  /** Waiting to resolve. A card on the stack does not leave the
   *  battlefield — it wears this ribbon in place, which is the durable
   *  signal (the stack panel can be closed; this cannot). */
  onStack?: boolean;
}

const MAX_VISIBLE_STICKERS = 3;

/**
 * Pure presentational card face — image / face-down back / placeholder plus
 * counters. Shared by the draggable `PlaytestCardView` and the top-level
 * `DragOverlay` copy so both render identically without duplicating markup.
 */
export const PlaytestCardFace = memo(
  forwardRef<HTMLDivElement, Props>(function PlaytestCardFace(
    {
      card,
      bf,
      size = 'md',
      ptHidden = false,
      countersHidden = false,
      onStack = false,
      className = '',
      ...rest
    },
    ref
  ) {
    const tapped = bf?.tapped ?? false;
    const faceDown = bf?.faceDown ?? false;
    const phased = bf?.phased ?? false;
    const stickers = bf?.stickers ?? [];
    const attached = bf?.attachedTo !== undefined;
    // Transform is independent of face-down: a transformed card can also be
    // turned face-down, in which case the back-of-card art still wins below.
    const src = bf?.showBackFace && card.backImageUrl ? card.backImageUrl : card.imageUrl;
    // A broken/slow image degrades to the same text placeholder used for
    // cards with no imageUrl at all — never a broken-image glyph. Resets
    // whenever the underlying image changes (e.g. a new card lands here, or a
    // transform swaps which face's art is showing).
    const [imgError, setImgError] = useState(false);
    useEffect(() => setImgError(false), [src]);
    // Face-down hides the body along with everything else: a morph is a 2/2
    // whatever is underneath, and printing the real numbers on the back of
    // the card would give it away.
    const pt = faceDown || ptHidden ? null : displayPT(card, bf);

    return (
      <div
        ref={ref}
        className={`playtest-card playtest-card--${size}${tapped ? ' playtest-card--tapped' : ''}${
          attached ? ' playtest-card--attached' : ''
        }${phased ? ' playtest-card--phased' : ''}${
          onStack ? ' playtest-card--on-stack' : ''
        }${className ? ` ${className}` : ''}`}
        // Hover/focus preview hook (CardHoverPreview.tsx): only the instance
        // id goes in the DOM — the preview resolves the image from React
        // state, never from a DOM attribute. Absent for a face-down card so
        // resting on one never reveals it.
        data-preview-id={!faceDown && src ? card.id : undefined}
        // Hover-target hook (hooks/use-hover-target.ts): which card a
        // per-card shortcut acts on when nothing is selected. Unlike the
        // preview id above this is set for a face-down card too — pressing Z
        // over one has to be able to turn it back up, and an id on its own
        // reveals nothing the board doesn't already show.
        data-card-id={card.id}
        // Token-ness for the hover preview, which is delegated off the same
        // attributes rather than threaded props (CardHoverPreview.tsx). A
        // boolean, unlike the image URL the preview resolves from React
        // state — and absent face-down, so the attribute reveals no more
        // than the ribbon above does.
        data-token={card.isToken && !faceDown ? '' : undefined}
        {...rest}
      >
        {onStack && (
          <span className="playtest-card__stack-ribbon" aria-hidden>
            Stack
          </span>
        )}
        {/* A token wears the word, the way a proxy at a real table does — a
            token copy of a printed card is otherwise pixel-identical to the
            card it copied, and the difference decides what survives a bounce.
            Hidden face-down along with everything else the back conceals. */}
        {card.isToken && !faceDown && (
          <span className="playtest-card__token-ribbon" aria-hidden>
            Token
          </span>
        )}
        {!faceDown && !countersHidden && bf && (
          <CardCounters counters={bf.counters} placement="inset" />
        )}
        {attached && (
          <span className="playtest-card__attached" title="Attached" aria-hidden>
            🔗
          </span>
        )}
        {phased && (
          <span className="playtest-card__phased-badge" title="Phased out" aria-hidden>
            👻
          </span>
        )}
        {faceDown ? (
          <div className="playtest-card__back" aria-label="Face-down card" />
        ) : src && !imgError ? (
          <img
            src={src}
            alt={card.name}
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="playtest-card__placeholder">{card.name}</div>
        )}
        {pt && (
          <span
            className={`playtest-card__pt${pt.modified ? ' is-modified' : ''}`}
            // One label, not two numbers read out separately — a screen
            // reader should say "3 slash 4", which is how the board is read
            // aloud at a table.
            aria-label={`${pt.power} by ${pt.toughness}`}
          >
            {/* Two boxes rather than "4/4": at the smallest card tier the
                slash costs a character's width and reads as noise, and the
                pair is what a real card prints. */}
            <span className="playtest-card__pt-half" aria-hidden>
              {pt.power}
            </span>
            <span className="playtest-card__pt-half" aria-hidden>
              {pt.toughness}
            </span>
          </span>
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
      </div>
    );
  })
);
