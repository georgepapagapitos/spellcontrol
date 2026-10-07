// @vitest-environment node
//
// The objective's move scorer (E540 S4) is read by the eval harness and, since
// S6, by the Cuts lane's pairing (coach-cut-swaps.ts, wrapped by use-cut-swaps.ts).
// No page, component or store imports the scorer directly: the pairing module is
// the one door, so the lane and the harness can't score a cut two ways.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = [
  join('lib', 'coach', 'coach-move-score'),
  join('lib', 'coach', 'coach-cut-swaps'),
  join('deck-builder', 'services', 'deckBuilder', 'coachEval') + sep,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('the move scorer is shadow-only', () => {
  it('is imported by nothing outside the eval harness and its own tests', () => {
    const offenders = files(SRC)
      .filter((p) => !ALLOWED.some((a) => relative(SRC, p).startsWith(a)))
      .filter((p) => /coach-move-score|coachShadow/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p));
    expect(offenders).toEqual([]);
  });
});
