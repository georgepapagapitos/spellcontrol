import { useEffect, useState } from 'react';
import './DeckHoverPeek.css';
import { ImageOff } from 'lucide-react';

/** How long the touch variant waits with no `imageUrl` before treating it as
 *  a genuine miss (vs. still resolving) and swapping the shimmer for a "no
 *  art" glyph. `useCardThumb`/Row art collapse "loading" and "not found" to
 *  the same `undefined`, so this is a grace window rather than a real
 *  settled signal — a lookup resolves well inside it in practice (E129). */
const TOUCH_MISSING_ART_TIMEOUT_MS = 1500;

/** The floating card-art preview shared by the deck list's desktop
 *  hover-peek and its touch long-press counterpart (E129). Positioned by
 *  `useDeckHoverPeek` / `useTouchPeek` (fixed, viewport coords). Decorative +
 *  non-interactive on both variants — the row's click/tap→sheet is the
 *  accessible path — so `pointer-events: none` + aria-hidden.
 *
 *  `variant="hover"` (default) is unchanged: renders nothing until
 *  `imageUrl` is in hand, since a fleeting mouse-over shouldn't flash a
 *  loading box.
 *  `variant="touch"` stays mounted through the loading window (shimmer) and
 *  degrades to a "no art" glyph on a genuine miss — a long-press is a
 *  deliberate hold, so it earns visible feedback instead of nothing. */
export function DeckHoverPeek({
  imageUrl,
  left,
  top,
  width,
  variant = 'hover',
}: {
  imageUrl?: string;
  left: number;
  top: number;
  /** Viewport-responsive width from the hook; height follows via CSS aspect-ratio. */
  width: number;
  variant?: 'hover' | 'touch';
}) {
  // Not reset back to false once the image arrives: `imageUrl` already wins
  // the render branch below regardless of `timedOut`, and the peek box is
  // always freshly mounted per press (conditionally rendered by the caller),
  // so a stale `true` never leaks into the next long-press.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (variant !== 'touch' || imageUrl) return; // nothing to schedule
    const t = window.setTimeout(() => setTimedOut(true), TOUCH_MISSING_ART_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [variant, imageUrl]);

  if (variant === 'hover') {
    if (!imageUrl) return null;
    return (
      <img
        className="deck-card-hover-peek"
        src={imageUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ left, top, width }}
      />
    );
  }

  return (
    <div
      className="deck-card-hover-peek deck-card-hover-peek-touch"
      aria-hidden="true"
      style={{ left, top, width }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" draggable={false} />
      ) : timedOut ? (
        <div className="deck-card-hover-peek-missing">
          <ImageOff width={22} height={22} strokeWidth={1.75} aria-hidden />
          <span>No art</span>
        </div>
      ) : (
        <div className="deck-card-hover-peek-loading" aria-hidden />
      )}
    </div>
  );
}
