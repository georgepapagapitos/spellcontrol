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

/**
 * True if the card is a land. Reads the FRONT face only, like `getCardType`:
 * the front is the face that sits in the pocket, and `getColorPalette` buckets
 * lands by identity. Reading the whole type line filed Drowner of Truth //
 * Drowned Jungle (a Devoid creature whose back is a land) under Multicolor.
 */
export function isLand(card: EnrichedCard): boolean {
  const front = (card.typeLine || '').toLowerCase().split(' // ')[0];
  if (front.includes('land')) return true;
  return basicLandColorByName(card.name) !== null;
}

/** Color-identity of a basic land detected purely by name. Returns null if not a basic. */
function basicLandColorByName(name: string): string | null {
  const n = (name ?? '').toLowerCase();
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

/**
 * How a color pip selection combines: `'any'` (OR — a card matches if it shows
 * any selected color; the historical default) or `'all'` (AND — the card's
 * colors are exactly the selection, so U means mono-blue and R + W means Boros,
 * not Naya).
 */
export type ColorMatchMode = 'any' | 'all';

/**
 * The single color-filter predicate behind every WUBRG+C pip row (collection,
 * lists, deck add-cards, shared views, friend collections) and the binder
 * `colorIdentity` rule, so Save as binder carries a color filter exactly. `key` is the
 * card's grouping key (`getColorKey`): 'C' for colorless, a color letter for
 * mono cards (covers printings whose `colorIdentity` is missing — resolved by
 * basic-land name), 'M' for multicolor. Selecting 'C' means "colorless"; in
 * 'all' mode combining it with a color is unsatisfiable and correctly matches
 * nothing.
 *
 * 'all' is an *exact* match, not a superset one: a card carrying a color the
 * user didn't pick is excluded, so a lone Blue pip lists mono-blue cards rather
 * than every card that happens to contain blue.
 */
export function colorSelectionMatches(
  key: string,
  colorIdentity: readonly string[],
  selected: ReadonlySet<string>,
  mode: ColorMatchMode = 'any'
): boolean {
  if (selected.size === 0) return true;
  const has = (c: string) => (c === 'C' ? key === 'C' : colorIdentity.includes(c) || key === c);
  const picks = [...selected];
  if (mode === 'any') return picks.some(has);
  const cardColors = key === 'C' ? ['C'] : colorIdentity.length > 0 ? colorIdentity : [key];
  return picks.every(has) && cardColors.every((c) => selected.has(c));
}
