// Guard: no value-level import cycles anywhere under frontend/src.
//
// WHY THIS IS A REAL BUG CLASS, NOT STYLE. A cycle between two modules that
// exchange *values* (functions, consts, classes) means module init order
// decides what each side sees. Whichever module the bundler evaluates second
// observes the first one's binding as `undefined` at its own top level — so a
// const initialized from a cycled import, or a decorator//HOC applied at module
// scope, silently becomes undefined. It typechecks, it usually works, and then
// it breaks when an unrelated import elsewhere changes the evaluation order.
// Type-only edges are erased at compile time and cannot do this, so they are
// deliberately ignored here.
//
// Four such cycles existed before this guard landed (store/decks <-> allocations,
// store/collection -> ... -> allocations, and cube generate <-> objective /
// refine). All four were fixed by pushing the shared leaf DOWN into its own
// module (`lib/allocations-core.ts`, `lib/cube/core.ts`) — never by importing
// back up into the parent. That is the fix to reach for when this test fails.
//
// There is intentionally NO allowlist. The count is zero; keep it zero.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const SRC = resolve(__dirname);
const SKIP_DIRS = new Set(['node_modules', '__snapshots__', '__fixtures__']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) sourceFiles(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** Resolve an import specifier to a file in src, or null for externals. */
function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // bare package specifier
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Files this one imports at least one VALUE from. `import type ...` and a
 * braced clause whose specifiers are all `type X` are skipped; `export * from`
 * and `export { x } from` count, since a re-export is a real runtime edge.
 */
function valueImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out = new Set<string>();
  const re = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const clause = m[1].trim();
    if (/^type\s/.test(clause)) continue;
    const braced = clause.match(/^\{([\s\S]*)\}$/);
    if (braced) {
      const names = braced[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every((n) => /^type\s/.test(n))) continue;
    }
    const target = resolveSpec(file, m[2]);
    if (target) out.add(target);
  }
  return [...out];
}

/** Every distinct elementary cycle reachable by DFS, as src-relative paths. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (node: string) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      const s = state.get(next) ?? 0;
      if (s === 1) {
        const cyc = stack.slice(stack.indexOf(next)).map((f) => relative(SRC, f));
        const key = [...cyc].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cyc);
        }
      } else if (s === 0) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const f of graph.keys()) if ((state.get(f) ?? 0) === 0) visit(f);
  return cycles;
}

describe('import graph', () => {
  const files = sourceFiles(SRC);
  const graph = new Map(files.map((f) => [f, valueImports(f)]));

  it('finds the source files it is asserting against', () => {
    // Guards the guard: a broken walk would make the cycle assertion below
    // pass vacuously.
    expect(files.length).toBeGreaterThan(500);
    expect([...graph.values()].some((v) => v.length > 0)).toBe(true);
  });

  it('has no value-level import cycles', () => {
    const cycles = findCycles(graph);
    const detail = cycles
      .sort((a, b) => a.length - b.length)
      .map((c) => `  [${c.length}] ${c.join(' -> ')} -> ${c[0]}`)
      .join('\n');
    expect(
      cycles.length,
      cycles.length === 0
        ? ''
        : `Found ${cycles.length} value-level import cycle(s).\n${detail}\n\n` +
            'Fix by moving the shared leaf DOWN into its own module (see ' +
            'lib/allocations-core.ts, lib/cube/core.ts), not by importing back up.'
    ).toBe(0);
  });
});
