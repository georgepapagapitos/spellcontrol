import type { EnrichedCard } from '../types';

/**
 * Visual foil variants we paint distinctly. Maps from Scryfall's promo_types /
 * finishes / frame_effects onto a small set of styles — niche promo types
 * (confetti, raised, step-and-repeat) fold into the closest visual cousin
 * rather than each getting their own one-off treatment.
 */
export type FoilStyle =
  | 'none'
  | 'regular'
  | 'etched'
  | 'textured'
  | 'oilslick'
  | 'gilded'
  | 'halo'
  | 'fracture';

/** The foil-relevant fields `classifyFoil` reads. Accepting this structural
 *  subset (rather than the full `EnrichedCard`) lets deck-view rows — which
 *  mirror these fields from the owned copy — reuse the classifier too. */
export type FoilClassifiable = Pick<
  EnrichedCard,
  'foil' | 'promoTypes' | 'finishes' | 'frameEffects'
>;

/**
 * Human label per finish style. Owned here (not in FoilBadge) so textual
 * surfaces — the badge pill and the card-preview meta token — share one
 * mapping and the wording never drifts.
 */
export const FOIL_LABEL: Record<Exclude<FoilStyle, 'none'>, string> = {
  regular: 'Foil',
  etched: 'Etched',
  textured: 'Textured',
  oilslick: 'Oil slick',
  gilded: 'Gilded',
  halo: 'Halo',
  fracture: 'Fracture',
};

/**
 * Specific finish label for a card ("Foil", "Etched", "Oil slick", …), or
 * null when the card isn't foil.
 */
export function foilFinishLabel(card: FoilClassifiable): string | null {
  const style = classifyFoil(card);
  return style === 'none' ? null : FOIL_LABEL[style];
}

export function classifyFoil(card: FoilClassifiable): FoilStyle {
  if (!card.foil) return 'none';
  const promo = new Set(card.promoTypes ?? []);
  // Order matters: promo treatments override the generic 'etched' finish.
  if (promo.has('fracturefoil')) return 'fracture';
  if (promo.has('oilslick')) return 'oilslick';
  if (promo.has('gilded') || promo.has('neonink')) return 'gilded';
  if (promo.has('halofoil') || promo.has('surgefoil')) return 'halo';
  if (promo.has('textured') || promo.has('confettifoil') || promo.has('raisedfoil'))
    return 'textured';
  const finishes = new Set(card.finishes ?? []);
  const frame = new Set(card.frameEffects ?? []);
  if (finishes.has('etched') || frame.has('etched')) return 'etched';
  return 'regular';
}
