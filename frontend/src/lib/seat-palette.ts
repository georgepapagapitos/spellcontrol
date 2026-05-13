/**
 * Seat-fallback palette used when a player has neither an explicit panel
 * color override nor a non-empty MTG color identity. The palette is
 * deterministic per game: a hash of the game id picks a starting offset,
 * then each seat takes the next entry — so within one game no two seats
 * collide (until the palette is exhausted), but a new game draws a fresh
 * sequence so the board looks different every time.
 *
 * Hues are vivid but not neon, weighted toward complementary contrast at
 * adjacent indices so seat 1 next to seat 2 reads as clearly different.
 */

export interface SeatPalette {
  base: string;
  edge: string;
  accent: string;
}

const PALETTE: SeatPalette[] = [
  { base: '#c9a83a', edge: '#f0d970', accent: '#fff1bd' }, // amber
  { base: '#c8332b', edge: '#e8615a', accent: '#ffaaa3' }, // coral red
  { base: '#b8378a', edge: '#e25aac', accent: '#ffa8d4' }, // magenta
  { base: '#6c4ad6', edge: '#9a7eff', accent: '#d4c4ff' }, // royal purple
  { base: '#3047c8', edge: '#5a73f0', accent: '#a8bcff' }, // indigo
  { base: '#1389d8', edge: '#4bb2ee', accent: '#a8dcf5' }, // sky blue
  { base: '#0a8a86', edge: '#22b8b1', accent: '#9bdfdb' }, // teal
  { base: '#1d9b5c', edge: '#3fc77f', accent: '#a8ebc4' }, // emerald
  { base: '#7cae1f', edge: '#a8d048', accent: '#d8ec9c' }, // lime
  { base: '#cf6712', edge: '#f08a3a', accent: '#ffc99c' }, // burnt orange
  { base: '#a72237', edge: '#d44b62', accent: '#f5a3b0' }, // crimson rose
  { base: '#5c378a', edge: '#8758b8', accent: '#c4a8e0' }, // plum
  { base: '#4858a8', edge: '#7383c8', accent: '#b8c4e8' }, // slate blue
  { base: '#1ba38a', edge: '#3fc7ad', accent: '#9beed5' }, // sea green
  { base: '#d4763a', edge: '#e89858', accent: '#ffc8a3' }, // pumpkin
  { base: '#9c4dc4', edge: '#bf7be0', accent: '#dcb8ee' }, // orchid
];

export const SEAT_PALETTE_COUNT = PALETTE.length;

// FNV-1a — small, fast, no dependencies. Output is a non-negative 32-bit int.
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic palette for a seat in a given game. The game id seeds a
 * starting offset; seats take successive palette entries so within one
 * game no two seats collide unless seat count > palette length.
 */
export function paletteForSeat(gameId: string, seat: number): SeatPalette {
  const offset = hash(gameId || 'default');
  return PALETTE[(offset + seat) % PALETTE.length];
}

/** Stable, non-randomized palette by index — used by the layout picker. */
export function paletteForIndex(index: number): SeatPalette {
  return PALETTE[index % PALETTE.length];
}
