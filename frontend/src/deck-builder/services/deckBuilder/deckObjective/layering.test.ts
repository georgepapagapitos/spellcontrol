// @vitest-environment node
//
// Guard: the objective never reaches the generator. E513's search will be
// CALLED by deckGenerator.ts, so any value import from the objective back into
// the generator (or its phases) closes an import cycle the moment the search
// is wired in. It happened once already: constraints.ts took normalizeCardName
// and copyLimit from deckInvariants.ts, which value-imports deckGenerator.ts;
// the two helpers now live in the leaf cardIdentity.ts. The fix for a failure
// here is the same: push the shared piece down into a leaf, never import up.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..', '..', '..');
const ENTRIES = ['index.ts', 'optimizer.ts'].map((f) => resolve(__dirname, f)).filter(existsSync);
const FORBIDDEN = [
  /deck-builder[\\/]services[\\/]deckBuilder[\\/]deckGenerator\.ts$/,
  /deck-builder[\\/]services[\\/]deckBuilder[\\/]deckInvariants\.ts$/,
  /deck-builder[\\/]services[\\/]deckBuilder[\\/]deckGeneration[\\/]/,
];

function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Value imports only: `import type` and all-`type` braces are erased at compile time. */
function valueImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    const clause = m[1].trim();
    if (clause.startsWith('type ')) continue;
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    if (braces && braces[1].split(',').every((s) => !s.trim() || /^type\s/.test(s.trim())))
      continue;
    const target = resolveSpec(file, m[2]);
    if (target) out.push(target);
  }
  return out;
}

describe('deckObjective layering', () => {
  it('reaches neither the generator nor its phases', () => {
    const parent = new Map<string, string | null>();
    const stack = ENTRIES.map((e) => [e, null] as [string, string | null]);
    while (stack.length) {
      const [file, from] = stack.pop()!;
      if (parent.has(file)) continue;
      parent.set(file, from);
      for (const next of valueImports(file)) stack.push([next, file]);
    }
    const offenders = [...parent.keys()].filter((f) => FORBIDDEN.some((re) => re.test(f)));
    const chains = offenders.map((f) => {
      const chain: string[] = [];
      for (let cur: string | null = f; cur; cur = parent.get(cur) ?? null)
        chain.unshift(relative(SRC, cur));
      return chain.join(' -> ');
    });
    expect(chains).toEqual([]);
    expect(parent.size).toBeGreaterThan(10);
  });
});
