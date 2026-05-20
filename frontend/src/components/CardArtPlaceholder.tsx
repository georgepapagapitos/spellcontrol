import React from 'react';

/**
 * Text-only card preview for offline mode (or anywhere an image URL is
 * unreachable). Renders the card's name + mana cost + type line in a card-
 * shaped frame so layouts that allocate space for art stay stable.
 *
 * Most card render sites already gracefully fall back to a name-only label
 * when `imageSmall` is missing (see CardSlot, CardPreview). This component
 * exists for spots that want an explicit "no image available" affordance —
 * the offline-mode settings preview, fallbacks for failed loads, etc.
 */
export interface CardArtPlaceholderProps {
  name: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  className?: string;
}

export function CardArtPlaceholder({
  name,
  manaCost,
  typeLine,
  oracleText,
  className,
}: CardArtPlaceholderProps): React.ReactElement {
  return (
    <div className={`card-art-placeholder ${className ?? ''}`.trim()} role="img" aria-label={name}>
      <div className="card-art-placeholder-header">
        <span className="card-art-placeholder-name">{name}</span>
        {manaCost && <span className="card-art-placeholder-mana">{manaCost}</span>}
      </div>
      {typeLine && <div className="card-art-placeholder-type">{typeLine}</div>}
      {oracleText && <div className="card-art-placeholder-text">{oracleText}</div>}
    </div>
  );
}
