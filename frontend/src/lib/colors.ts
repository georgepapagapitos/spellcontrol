import type { EnrichedCard } from '../types';

/**
 * Color-identity grouping key. Lands group by their color identity too —
 * Forest → G, Plains → W, Wastes → C, dual lands → M.
 *
 * Returns:
 *   'W'/'U'/'B'/'R'/'G' for monocolor (or mono-color-identity lands)
 *   'M' for any multicolor combination
 *   'C' for colorless (incl. basic Wastes / colorless lands)
 *   '?' if Scryfall data is missing (so user knows lookup failed)
 */
export function getColorKey(card: EnrichedCard): string {
  if (!card.colorIdentity) {
    // Scryfall lookup missed — basic lands have well-known names so we can still bucket those.
    return basicLandColorByName(card.name) ?? '?';
  }

  const ci = card.colorIdentity;
  if (ci.length === 0) return 'C';
  if (ci.length === 1) return ci[0];
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

export interface ColorInfo {
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
  B: { label: 'Black', pip: '#4a3e58', border: '#1f1828', order: 2 },
  R: { label: 'Red', pip: '#d8442a', border: '#9c2614', order: 3 },
  G: { label: 'Green', pip: '#4ca352', border: '#1f6e2a', order: 4 },
  M: { label: 'Multicolor', pip: '#dd8a1f', border: '#9a5e0e', order: 5 },
  C: { label: 'Colorless / Artifact', pip: '#8a96ac', border: '#4a566a', order: 6 },
  L: { label: 'Land', pip: '#b88848', border: '#6e4a14', order: 7 },
  '?': { label: 'Unknown (Scryfall miss)', pip: '#e0b870', border: '#9a6a18', order: 8 },
  ALL: { label: 'All cards', pip: '#a0a8b8', border: '#6a7080', order: 99 },
};

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L', '?'];
