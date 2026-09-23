import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Guard: `matchCombosLocal` (this directory) is a hand-duplicated port of the
 * backend's `matchCombos` (backend/src/combos/match.ts) — there's no shared
 * module between them (see match-combos.ts's own header comment). E213: the
 * `almostInCollection` bucket is capped at `ALMOST_LIMIT` and both files must
 * report the pre-cap true count via `almostInCollectionTotal` so the UI can
 * disclose the truncation instead of a bare 200 reading as the real answer.
 * If a future edit caps one file differently, or drops the total field from
 * one, this fails — a numeric or shape divergence here silently makes the
 * "200 of N" disclosure lie on whichever surface picks the offline path.
 */

const here = dirname(fileURLToPath(import.meta.url));
const localSrc = readFileSync(join(here, 'match-combos.ts'), 'utf8');
const backendSrc = readFileSync(
  join(here, '..', '..', '..', '..', 'backend', 'src', 'combos', 'match.ts'),
  'utf8'
);

function almostLimit(src: string): string | undefined {
  return src.match(/ALMOST_LIMIT\s*=\s*(\d+)/)?.[1];
}

describe('offline matcher stays in lockstep with the backend matcher (E213)', () => {
  it('caps almostInCollection at the same ALMOST_LIMIT in both files', () => {
    const local = almostLimit(localSrc);
    const backend = almostLimit(backendSrc);
    expect(
      local,
      'ALMOST_LIMIT missing from frontend/src/lib/offline/match-combos.ts'
    ).toBeDefined();
    expect(backend, 'ALMOST_LIMIT missing from backend/src/combos/match.ts').toBeDefined();
    expect(local, 'the two ALMOST_LIMIT constants have drifted apart').toBe(backend);
  });

  it('both files disclose the true pre-truncation count as almostInCollectionTotal', () => {
    const totalField = /almostInCollectionTotal:\s*almostInCollection\.length/;
    expect(
      localSrc,
      'frontend match-combos.ts must return almostInCollectionTotal: almostInCollection.length'
    ).toMatch(totalField);
    expect(
      backendSrc,
      'backend match.ts must return almostInCollectionTotal: almostInCollection.length'
    ).toMatch(totalField);
  });
});

/** Field names in the object literal `toSummary` returns in a matcher source file. */
function summaryKeys(src: string): string[] {
  const body = src.match(/function toSummary\([^)]*\)[^{]*\{\s*return \{([\s\S]*?)\n {2}\};/)?.[1];
  if (!body) return [];
  return [...body.matchAll(/^ {4}(\w+):/gm)].map((m) => m[1]!).sort();
}

describe('both matchers hand back the same combo summary fields', () => {
  // The browser prefers this local matcher, and until 2026-09-23 its toSummary
  // dropped bracketTag: every combo reached the bracket estimate untagged, so
  // the Exhibition/Core rule and the Ruthless escalation never ran in the app.
  it('toSummary returns the same keys in both files', () => {
    const local = summaryKeys(localSrc);
    const backend = summaryKeys(backendSrc);
    expect(backend, 'could not read backend toSummary').toContain('bracketTag');
    expect(local, 'frontend match-combos.ts toSummary has drifted from the backend').toEqual(
      backend
    );
  });
});
