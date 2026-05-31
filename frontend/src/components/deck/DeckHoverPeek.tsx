import './DeckHoverPeek.css';

/** The floating card-art image for the deck list's desktop hover-peek.
 *  Positioned by `useDeckHoverPeek` (fixed, viewport coords). Decorative +
 *  non-interactive — the row's click→sheet is the accessible path — so
 *  `pointer-events: none` + aria-hidden. */
export function DeckHoverPeek({
  imageUrl,
  left,
  top,
}: {
  imageUrl?: string;
  left: number;
  top: number;
}) {
  if (!imageUrl) return null;
  return (
    <img
      className="deck-card-hover-peek"
      src={imageUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ left, top }}
    />
  );
}
