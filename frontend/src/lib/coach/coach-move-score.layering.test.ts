// @vitest-environment node
//
// Shadow mode (E540 S4): the objective's move scorer is read by the eval
// harness only. No page, hook, component or store imports it until S5 lets the
// feed use it. When S5 lands, this guard is the line to move.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = [
  join('lib', 'coach', 'coach-move-score'),
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
