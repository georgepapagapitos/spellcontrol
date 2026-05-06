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
  // Brighter / more saturated pips for better contrast on the dark surface and
  // stronger separation between adjacent buckets (notably W vs M, B vs C).
  W: { label: 'White', pip: '#f5efb8', border: '#a89530', order: 0 },
  U: { label: 'Blue', pip: '#4a9ee0', border: '#1860a8', order: 1 },
  B: { label: 'Black', pip: '#6b5878', border: '#2a2030', order: 2 },
  R: { label: 'Red', pip: '#e85838', border: '#a02818', order: 3 },
  G: { label: 'Green', pip: '#52b860', border: '#1e7030', order: 4 },
  M: { label: 'Multicolor', pip: '#e8b020', border: '#b07810', order: 5 },
  C: { label: 'Colorless / Artifact', pip: '#a0b0c8', border: '#506070', order: 6 },
  L: { label: 'Land', pip: '#d0a060', border: '#806020', order: 7 },
  '?': { label: 'Unknown (Scryfall miss)', pip: '#fadfad', border: '#c89020', order: 8 },
  ALL: { label: 'All cards', pip: '#e0e0e0', border: '#b0b0b0', order: 99 },
};

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L', '?'];
