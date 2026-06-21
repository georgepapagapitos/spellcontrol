import type { EnrichedCard } from './types.js';

/**
 * The color letters a card is bucketed by: color identity for lands (so a
 * Forest sits with green), the card's own printed colors otherwise. `colors`
 * falls back to `colorIdentity` for cards enriched before the dedicated field
 * existed. Returns undefined when Scryfall data is missing entirely.
 */
export function getColorPalette(card: EnrichedCard): string[] | undefined {
  return isLand(card) ? card.colorIdentity : (card.colors ?? card.colorIdentity);
}

export function getColorKey(card: EnrichedCard): string {
  const palette = getColorPalette(card);

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

/**
 * Map a color-identity array (e.g. ['G', 'U']) to the canonical color key
 * used across the app: single-color → that letter, empty → 'C' (colorless),
 * multiple → 'M' (multicolor). Does NOT resolve land bucketing — use
 * `getColorKey(card)` when you have a full EnrichedCard.
 */
export function getColorKeyFromIdentity(colorIdentity: string[]): string {
  if (colorIdentity.length === 0) return 'C';
  if (colorIdentity.length === 1) return colorIdentity[0];
  return 'M';
}
