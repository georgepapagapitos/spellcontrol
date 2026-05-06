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
 * Type lines look like: "Legendary Creature — Human Wizard" or "Artifact — Equipment"
 * We pick the first type that appears in TYPE_ORDER (creatures dominate over artifacts on
 * artifact-creatures, etc — same convention most binder organizers use).
 */
export function getCardType(card: EnrichedCard): string {
  const type = (card.typeLine || '').toLowerCase();
  if (!type) return 'other';

  // Strip everything after the em dash / hyphen — supertypes and subtypes don't matter
  const main = type.split(/[—-]/)[0];

  for (const t of TYPE_ORDER) {
    if (main.includes(t)) return t;
  }
  return 'other';
}
