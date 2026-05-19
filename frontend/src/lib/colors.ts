import type { EnrichedCard } from '../types';

/**
 * Color grouping key. Non-land cards bucket by their *printed color* (mana
 * cost / color indicator / characteristic-defining ability), matching ManaBox:
 * a mono-white card with a `{4}{G}{G}:` activated ability (e.g. Shalai, Voice
 * of Plenty) groups under White, not Multicolor. Color identity pulled from
 * rules text does NOT promote a card to multicolor here.
 *
 * Lands are colorless by rule, so they instead bucket by color identity —
 * Forest → G, Plains → W, Wastes → C, dual / fetch lands → M.
 *
 * Returns:
 *   'W'/'U'/'B'/'R'/'G' for monocolor (or mono-color-identity lands)
 *   'M' for any multicolor combination
 *   'C' for colorless (incl. basic Wastes / colorless lands)
 *   '?' if Scryfall data is missing (so user knows lookup failed)
 */
export function getColorKey(card: EnrichedCard): string {
  // Lands key off color identity; everything else off the card's own colors.
  // `colors` falls back to `colorIdentity` for cards enriched before the
  // dedicated field existed, then to a basic-land name guess.
  const palette = isLand(card) ? card.colorIdentity : (card.colors ?? card.colorIdentity);

  if (!palette) {
    // Scryfall lookup missed — basic lands have well-known names so we can still bucket those.
    return basicLandColorByName(card.name) ?? '?';
  }
  if (palette.length === 0) return 'C';
  if (palette.length === 1) return palette[0];
  return 'M';
}

/** True if the card is a land — used for slot styling, not for color grouping. */
export function isLand(card: EnrichedCard): boolean {
  const type = (card.typeLine || '').toLowerCase();
  if (type.includes('land')) return true;
  return basicLandColorByName(card.name) !== null;
}

/** Color-identity of a basic land detected purely by name. Returns null if not a basic. */
function basicLandColorByName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.startsWith('plains')) return 'W';
  if (n.startsWith('island')) return 'U';
  if (n.startsWith('swamp')) return 'B';
  if (n.startsWith('mountain')) return 'R';
  if (n.startsWith('forest')) return 'G';
  if (n.startsWith('wastes')) return 'C';
  return null;
}

interface ColorInfo {
  label: string;
  pip: string;
  border: string;
  order: number;
}

export const COLOR_INFO: Record<string, ColorInfo> = {
  // Saturated, theme-stable values — readable on both light and dark surfaces,
  // with strong separation between adjacent buckets (W vs M, B vs C).
  W: { label: 'White', pip: '#d9c469', border: '#8a7320', order: 0 },
  U: { label: 'Blue', pip: '#3a85cc', border: '#1c5a96', order: 1 },
  B: { label: 'Black', pip: '#2a2434', border: '#0e0a16', order: 2 },
  R: { label: 'Red', pip: '#d8442a', border: '#9c2614', order: 3 },
  G: { label: 'Green', pip: '#4ca352', border: '#1f6e2a', order: 4 },
  M: { label: 'Multicolor', pip: '#d4a838', border: '#8a6a12', order: 5 },
  C: { label: 'Colorless / Artifact', pip: '#a8b0bc', border: '#5e6878', order: 6 },
  L: { label: 'Land', pip: '#b88848', border: '#6e4a14', order: 7 },
  '?': { label: 'Unknown (Scryfall miss)', pip: '#e0b870', border: '#9a6a18', order: 8 },
  ALL: { label: 'All cards', pip: '#a0a8b8', border: '#6a7080', order: 99 },
};

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L', '?'];
