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
 * `showLabel` names a *special* finish beside the chip (Etched, Oil slick, …)
 * for roomy rows like the collection list. Plain foil shows the chip alone —
 * the "F" already says "foil", so the word would be redundant.
 */
export interface FoilBadgeProps {
  card: FoilClassifiable;
  /** Name the finish beside the chip for special finishes (roomy list rows). */
  showLabel?: boolean;
  className?: string;
}

export function FoilBadge({ card, showLabel, className }: FoilBadgeProps): JSX.Element | null {
  const style = classifyFoil(card);
  if (style === 'none') return null;
  const label = FOIL_LABEL[style];
  // "Foil foil" reads badly — the generic finish is just "Foil".
  const aria = style === 'regular' ? 'Foil' : `${label} foil`;

  // The "F" chip alone means "foil"; only special finishes add their name.
  if (!showLabel || style === 'regular') {
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
