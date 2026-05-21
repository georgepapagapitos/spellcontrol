import type { EnrichedCard } from './types.js';

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

/**
 * Card supertypes. Closed set per the comprehensive rules — appears
 * before the primary type in the type line ("Legendary Creature —
 * Angel"). Lowercased for easy comparison against parsed tokens.
 */
export const SUPERTYPES = ['basic', 'legendary', 'snow', 'world', 'token', 'ongoing'] as const;

/**
 * Card primary types. Closed set per the comprehensive rules — a card
 * can have multiple (e.g. "Artifact Creature", "Creature Land"). Same
 * lowercased values as TYPE_ORDER but the surface name reflects intent:
 * TYPE_ORDER is for binning, TYPES is for filter authoring.
 */
export const TYPES = [
  'creature',
  'planeswalker',
  'instant',
  'sorcery',
  'enchantment',
  'artifact',
  'land',
  'battle',
  'tribal',
] as const;

/**
 * Parse a Scryfall type line into supertypes / types / subtypes.
 * Conservative: only tokens that appear in the closed SUPERTYPES /
 * TYPES sets are bucketed there; anything before " — " that isn't
 * recognized falls through (rare — most non-recognized tokens come
 * after the dash anyway). Subtypes are whatever sits after " — ".
 *
 * Multi-face cards use the first face only — same convention as
 * `getCardType`.
 */
export function parseTypeLine(typeLine: string | undefined): {
  supertypes: string[];
  types: string[];
  subtypes: string[];
} {
  const line = (typeLine || '').toLowerCase().trim();
  if (!line) return { supertypes: [], types: [], subtypes: [] };
  const firstFace = line.split(' // ')[0];
  const [left, right] = firstFace.split(' — ');
  const leftTokens = left.split(/\s+/).filter(Boolean);
  const supertypeSet = new Set<string>(SUPERTYPES);
  const typeSet = new Set<string>(TYPES);
  const supertypes: string[] = [];
  const types: string[] = [];
  for (const tok of leftTokens) {
    if (supertypeSet.has(tok)) supertypes.push(tok);
    else if (typeSet.has(tok)) types.push(tok);
  }
  const subtypes = right ? right.split(/\s+/).filter(Boolean) : [];
  return { supertypes, types, subtypes };
}

/** mana-font icon name for an internal type bucket. */
export function typeIcon(t: string): string {
  switch (t) {
    case 'creature':
      return 'creature';
    case 'instant':
      return 'instant';
    case 'sorcery':
      return 'sorcery';
    case 'artifact':
      return 'artifact';
    case 'enchantment':
      return 'enchantment';
    case 'land':
      return 'land';
    case 'planeswalker':
      return 'planeswalker';
    case 'battle':
      return 'battle';
    default:
      return 'multiple';
  }
}
