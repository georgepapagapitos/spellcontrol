import './FoilBadge.css';
import { type JSX } from 'react';
import { classifyFoil, type FoilClassifiable, type FoilStyle } from '@/lib/foil-style';

/**
 * The one canonical foil indicator — a small iridescent pip, tinted per finish
 * via the shared `.foil-{style}` palettes (holographic.css). Replaces the
 * scattered hand-rolled foil markers (the list pill, the picker text suffix,
 * the deck-row dot) so every dense surface reads the same.
 *
 * Image-heavy surfaces (card art) keep their own holographic shimmer overlay —
 * that's a frame treatment, not a badge; this is only for the text/list rows
 * that have no art to carry the shine.
 *
 * `showLabel` adds the finish name beside the pip (for roomy rows like the
 * collection list); omit it for tight metadata rows where the pip alone reads.
 */
const FOIL_LABEL: Record<Exclude<FoilStyle, 'none'>, string> = {
  regular: 'Foil',
  etched: 'Etched',
  textured: 'Textured',
  oilslick: 'Oil slick',
  gilded: 'Gilded',
  halo: 'Halo',
  fracture: 'Fracture',
};

export interface FoilBadgeProps {
  card: FoilClassifiable;
  /** Show the finish name beside the pip (roomy list rows). */
  showLabel?: boolean;
  className?: string;
}

export function FoilBadge({ card, showLabel, className }: FoilBadgeProps): JSX.Element | null {
  const style = classifyFoil(card);
  if (style === 'none') return null;
  const label = FOIL_LABEL[style];
  // "Foil foil" reads badly — the generic finish is just "Foil".
  const aria = style === 'regular' ? 'Foil' : `${label} foil`;

  if (!showLabel) {
    return (
      <span
        className={`foil-badge foil-${style}${className ? ` ${className}` : ''}`}
        role="img"
        aria-label={aria}
        title={aria}
      />
    );
  }
  return (
    <span className={`foil-badge-pill${className ? ` ${className}` : ''}`} title={aria}>
      <span className={`foil-badge foil-${style}`} aria-hidden="true" />
      <span className="foil-badge-text">{label}</span>
      <span className="sr-only">{aria}</span>
    </span>
  );
}
