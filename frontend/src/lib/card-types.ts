import type { EnrichedCard } from '../types';

export const TYPE_ORDER = [
  'creature',
  'planeswalker',
  'instant',
  'sorcery',
  'enchantment',
  'artifact',
  'land',
  'battle',
  'other',
];

/**
 * Extracts the primary card type from Scryfall's type_line.
 *
 * Type lines look like:
 *   "Legendary Creature — Human Wizard"
 *   "Artifact — Equipment"
 *   "Land — Swamp Mountain // Land — Swamp Mountain" (multi-face cards)
 *
 * We strip subtypes (everything after " — ") and only look at the first face,
 * then return the first match in TYPE_ORDER. Creatures dominate over artifacts on
 * artifact-creatures, etc — same convention most binder organizers use.
 */
export function getCardType(card: EnrichedCard): string {
  const type = (card.typeLine || '').toLowerCase().trim();
  if (!type) return 'other';

  // For multi-face cards (split, MDFC, reversible) the first face is the one we route on.
  const firstFace = type.split(' // ')[0];
  // Drop subtypes — Scryfall uses " — " (em-dash with surrounding spaces).
  const beforeSubtypes = firstFace.split(' — ')[0];

  for (const t of TYPE_ORDER) {
    if (beforeSubtypes.includes(t)) return t;
  }
  return 'other';
}
