/**
 * The date `HARDCODED_GAME_CHANGERS` (in `index.ts`) was last checked against the Rules Committee's
 * announcement and the live `is:gamechanger` query (ISO date). Bump it with
 * the list, in the same commit. The scheduled drift check
 * (`.github/workflows/game-changers-drift.yml`) is what notices the list has
 * moved; this is what tells a reader how old the hardcoded copy is.
 */
export const GAME_CHANGERS_AS_OF = '2026-02-09';

/** Front face of a Scryfall card name: the list carries both forms of a double-faced card. */
const gcFrontFace = (name: string) => name.split(' // ')[0];

export interface GameChangerDrift {
  /** On the live list, missing from the hardcoded one (front-face names, sorted). */
  added: string[];
  /** On the hardcoded list, gone from the live one (front-face names, sorted). */
  removed: string[];
}

/**
 * Compare a live `is:gamechanger` name list against the hardcoded one (`known`, normally `HARDCODED_GAME_CHANGERS`). Compared
 * by front face, so Scryfall's "A // B" and the list's front-face entry for the
 * same card never read as a difference.
 */
export function diffGameChangers(
  live: Iterable<string>,
  known: Iterable<string>
): GameChangerDrift {
  const liveFronts = new Set([...live].map(gcFrontFace));
  const knownFronts = new Set([...known].map(gcFrontFace));
  const sorted = (xs: Iterable<string>) => [...xs].sort((a, b) => a.localeCompare(b));
  return {
    added: sorted([...liveFronts].filter((n) => !knownFronts.has(n))),
    removed: sorted([...knownFronts].filter((n) => !liveFronts.has(n))),
  };
}
