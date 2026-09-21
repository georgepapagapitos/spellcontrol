import { forwardRef, memo, useEffect, useState } from 'react';
import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';
import { displayPT } from '../lib/power-toughness';

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  card: PlaytestCard;
  bf?: BattlefieldCard;
  size?: 'sm' | 'md' | 'lg';
  /** Hides the read-only power/toughness box — the battlefield renders
   *  editable badges beside the card instead (see `CardPtBadges`). */
  ptHidden?: boolean;
  /** Waiting to resolve. A card on the stack does not leave the
   *  battlefield — it wears this ribbon in place, which is the durable
   *  signal (the stack panel can be closed; this cannot). */
  onStack?: boolean;
}

const MAX_VISIBLE_STICKERS = 3;
/** Same cap for counters: the smallest card tier clips a fourth badge. */
const MAX_VISIBLE_COUNTERS = 3;

/** What a counter badge prints. `+1/+1` and `-1/-1` get their sign, because
 *  those are the two everyone reads at a glance; anything else gets its
 *  first letter, with the full name in the label and the tooltip. */
function counterMark(kind: string): string {
  if (kind === '+1/+1') return '+';
  if (kind === '-1/-1') return '−';
  return kind.slice(0, 1).toUpperCase();
}

/** Sort key: the body-changing counters first, then everything else. */
function counterRank(kind: string): number {
  if (kind === '+1/+1') return 0;
  if (kind === '-1/-1') return 1;
  return 2;
}

/**
 * Pure presentational card face — image / face-down back / placeholder plus
 * counters. Shared by the draggable `PlaytestCardView` and the top-level
 * `DragOverlay` copy so both render identically without duplicating markup.
 */
export const PlaytestCardFace = memo(
  forwardRef<HTMLDivElement, Props>(function PlaytestCardFace(
    { card, bf, size = 'md', ptHidden = false, onStack = false, className = '', ...rest },
    ref
  ) {
    const tapped = bf?.tapped ?? false;
    const faceDown = bf?.faceDown ?? false;
    const phased = bf?.phased ?? false;
    const counters = bf?.counters ?? {};
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
    // Ordered so the two that change a creature's size come first: they are
    // the ones a player is reading the board for, and the ones the P/T box
    // above has already folded in.
    const counterList = faceDown
      ? []
      : Object.entries(counters).sort(([a], [b]) => counterRank(a) - counterRank(b));

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
        {...rest}
      >
        {onStack && (
          <span className="playtest-card__stack-ribbon" aria-hidden>
            Stack
          </span>
        )}
        {counterList.length > 0 && (
          <div className="playtest-card__counters">
            {counterList.slice(0, MAX_VISIBLE_COUNTERS).map(([kind, n]) => (
              <span
                key={kind}
                className={`playtest-card__counter${
                  kind === '+1/+1' ? ' is-plus' : kind === '-1/-1' ? ' is-minus' : ''
                }`}
                // The kind is in the label rather than printed: a badge wide
                // enough to spell "experience" would cover the art it sits on.
                aria-label={`${n} ${kind} counter${n === 1 ? '' : 's'}`}
                title={`${kind}: ${n}`}
              >
                <span className="playtest-card__counter-mark" aria-hidden>
                  {counterMark(kind)}
                </span>
                <span className="playtest-card__counter-n" aria-hidden>
                  {n}
                </span>
              </span>
            ))}
            {counterList.length > MAX_VISIBLE_COUNTERS && (
              <span
                className="playtest-card__counter"
                aria-label={counterList
                  .slice(MAX_VISIBLE_COUNTERS)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(', ')}
                title={counterList
                  .slice(MAX_VISIBLE_COUNTERS)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              >
                <span className="playtest-card__counter-n" aria-hidden>
                  +{counterList.length - MAX_VISIBLE_COUNTERS}
                </span>
              </span>
            )}
          </div>
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
