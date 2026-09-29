// The value-level import graph the structural guards share
// (import-cycles.test.ts, layer-boundaries.test.ts): every non-test source
// file under src, and the src files each one imports at least one VALUE from.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export const SRC = resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '__snapshots__', '__fixtures__']);

export function sourceFiles(dir: string = SRC, out: string[] = []): string[] {
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
export function valueImports(file: string): string[] {
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
