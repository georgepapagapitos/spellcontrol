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
  W: { label: 'White', pip: '#faf6e0', border: '#b8a828', order: 0 },
  U: { label: 'Blue', pip: '#b8d4f0', border: '#1060b0', order: 1 },
  B: { label: 'Black', pip: '#989098', border: '#201c28', order: 2 },
  R: { label: 'Red', pip: '#f0c8b8', border: '#c82818', order: 3 },
  G: { label: 'Green', pip: '#b8e0b8', border: '#1e7030', order: 4 },
  M: { label: 'Multicolor', pip: '#f8e8a0', border: '#c89820', order: 5 },
  C: { label: 'Colorless / Artifact', pip: '#d8d8d8', border: '#909090', order: 6 },
  L: { label: 'Land', pip: '#e0d0b0', border: '#a08040', order: 7 },
  '?': { label: 'Unknown (Scryfall miss)', pip: '#fadfad', border: '#c89020', order: 8 },
  ALL: { label: 'All cards', pip: '#e0e0e0', border: '#b0b0b0', order: 99 },
};

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L', '?'];
