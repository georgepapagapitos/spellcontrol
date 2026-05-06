import type { EnrichedCard } from '../types';

/**
 * Color identity grouping key. Uses Scryfall's color_identity (most authoritative for EDH binders),
 * falling back to type-line heuristic for lands and a "C" colorless bucket otherwise.
 *
 * Returns:
 *   'L' for lands
 *   'W'/'U'/'B'/'R'/'G' for monocolor
 *   'M' for any multicolor combination
 *   'C' for colorless non-lands
 *   '?' if Scryfall data is missing (so user knows lookup failed)
 */
export function getColorKey(card: EnrichedCard): string {
  // Lands: detect via type line first (most reliable), then fall back to basic name check
  const type = (card.typeLine || '').toLowerCase();
  if (type.includes('land')) return 'L';

  if (!card.colorIdentity) {
    // Scryfall lookup missed — use a coarse fallback based on basic land names
    if (isBasicLandByName(card.name)) return 'L';
    return '?';
  }

  const ci = card.colorIdentity;
  if (ci.length === 0) return 'C';
  if (ci.length === 1) return ci[0];
  return 'M';
}

function isBasicLandByName(name: string): boolean {
  const n = name.toLowerCase();
  return ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'].some((b) => n.startsWith(b));
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
