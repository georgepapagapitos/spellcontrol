// "What does a pack from this cube look like" — CubeCobra's sample-pack
// reference. Pure and seeded so it's testable and a re-render doesn't reshuffle.

import { mulberry32, shuffle } from '../playtest/rng';

/**
 * `size` distinct picks drawn at random from the cube. A cube smaller than
 * `size` returns every pick, shuffled. Same seed → same pack.
 *
 * Generic (not `Pick[]`-only) so a Commander cube's page can pass
 * `[...cube.picks, ...(cube.legends ?? [])]` — legends fall in at NATURAL
 * odds (board #12, PR1 open question 5: no guaranteed-slot pack templating),
 * which a plain draw from the combined pool already gives for free. A
 * limited cube (no `legends`) degrades to exactly the old behaviour.
 */
export function samplePack<T>(picks: readonly T[], seed: number, size = 15): T[] {
  return shuffle(picks, mulberry32(seed)).slice(0, size);
}
