import './FoilBadge.css';
import { type JSX } from 'react';
import { classifyFoil, FOIL_LABEL, type FoilClassifiable } from '@/lib/foil-style';

/**
 * The one canonical foil indicator — a small "F" chip on an iridescent
 * holographic background, tinted per finish via the shared `.foil-{style}`
 * palettes (holographic.css). Replaces the scattered hand-rolled foil markers
 * (the list pill, the picker text suffix, the deck-row dot) so every dense
 * surface reads the same.
 *
 * Image-heavy surfaces (card art) keep their own holographic shimmer overlay —
 * that's a frame treatment, not a badge; this is only for the text/list rows
 * that have no art to carry the shine.
 *
 * The per-finish tint already distinguishes finishes (etched, oil slick, …);
 * the finish name rides along in the chip's `title`/`aria-label`, so no inline
 * text label is needed.
 */
export interface FoilBadgeProps {
  card: FoilClassifiable;
  className?: string;
}

export function FoilBadge({ card, className }: FoilBadgeProps): JSX.Element | null {
  const style = classifyFoil(card);
  if (style === 'none') return null;
  // "Foil foil" reads badly — the generic finish is just "Foil".
  const aria = style === 'regular' ? 'Foil' : `${FOIL_LABEL[style]} foil`;

  return (
    <span
      className={`foil-badge foil-${style}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={aria}
      title={aria}
    />
  );
}
