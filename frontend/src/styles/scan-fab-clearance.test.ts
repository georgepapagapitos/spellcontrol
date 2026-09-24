/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The floating Scan button sits over the bottom-right of the scroll region, so
// the region reserves room at its end for the last row to scroll clear of it.
// That reservation was written as `.app-main:has(.scan-fab-root)`, but the
// button is not INSIDE .app-main: Layout.tsx mounts <ScanFab> as a sibling
// after </main>. `:has()` only looks at descendants, so the rule never matched
// and the button sat on top of the last row of every page (found 2026-09-24,
// T135). The reservation must be keyed on an ancestor of both: the shell.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('Scan button clearance', () => {
  it('mounts the Scan button outside the scroll region', () => {
    const layout = readFileSync(join(srcRoot, 'components', 'Layout.tsx'), 'utf8');
    const mainClose = layout.indexOf('</main>');
    const fab = layout.indexOf('<ScanFab');
    expect(mainClose).toBeGreaterThan(-1);
    expect(fab).toBeGreaterThan(mainClose);
  });

  it('keys the clearance on the shell, never on .app-main:has(...)', () => {
    const offenders: string[] = [];
    let shellRule = false;
    for (const file of cssFiles(srcRoot)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/\.app-main:has\([^)]*scan-fab/.test(css)) offenders.push(file);
      if (/\.app-shell:has\(\.scan-fab-btn\)\s+\.app-main\s*\{[^}]*padding-bottom/.test(css))
        shellRule = true;
    }
    expect(offenders, 'a :has() on .app-main can never see the Scan button').toEqual([]);
    expect(shellRule).toBe(true);
  });
});
