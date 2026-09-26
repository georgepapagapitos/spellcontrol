// "What does a pack from this cube look like" — CubeCobra's sample-pack
// reference. Pure and seeded so it's testable and a re-render doesn't reshuffle.

import { mulberry32, shuffle } from '../playtest/rng';
import type { Pick } from './generate';

/** `size` distinct picks drawn at random from the cube. A cube smaller than
 *  `size` returns every pick, shuffled. Same seed → same pack. */
export function samplePack(picks: readonly Pick[], seed: number, size = 15): Pick[] {
  return shuffle(picks, mulberry32(seed)).slice(0, size);
}
