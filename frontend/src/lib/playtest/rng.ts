/**
 * Tiny seedable PRNG (mulberry32) so playtest shuffles are reproducible in
 * tests and survive snapshot replay. Not cryptographically secure — never use
 * for anything sensitive.
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with an injected RNG. Returns a new array; advances the RNG. */
export function shuffle<T>(input: readonly T[], rand: () => number): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Advance a seed by one step. Lets us shuffle without sharing a mutable RNG
 * across reducer calls — each shuffle derives its next seed deterministically.
 */
export function nextSeed(seed: number): number {
  const rand = mulberry32(seed);
  // Burn one value, then re-derive an integer seed from the next.
  rand();
  return Math.floor(rand() * 0xffffffff) >>> 0;
}
