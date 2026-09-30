/**
 * Per-game random streams for the goldfish (engine.ts).
 *
 * Each game draws its own stream from (run seed, game index) alone. With one
 * stream across all games, a single mulligan decided differently (one extra
 * shuffle) shifted every later game, so two decks that differ by one card
 * shared no games at all. Per game, game g shuffles the same library POSITIONS
 * the same way for both decks, so a caller that keeps a swapped card in the
 * slot of the card it replaced gets common random numbers (index.ts,
 * "Comparing decks").
 */

/** The seed of game `g`: the run seed mixed with the game index (a Weyl step, then a murmur finalizer). */
export function gameSeed(seed: number, g: number): number {
  let h = (seed ^ Math.imul(g + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
