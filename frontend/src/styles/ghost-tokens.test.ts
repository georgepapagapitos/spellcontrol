/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Guard against T35-migration ghost tokens (see STYLE_GUIDE.md § Color & spacing).
// These custom-property names were renamed or removed; CSS resolves an undefined
// var() to its fallback (transparent background, #fff text — a WCAG-AA failure on
// light-accent themes) with NO build error or console warning. The full-app
// UX-cohesion sweep found 57 live references across 22 files. This test reads
// every stylesheet off disk and fails if any dead name is referenced via var(),
// so a regression is caught at CI instead of shipping a silent visual defect.
//
// dead name        -> use instead
//   --surface1/2/3  -> --surface / --surface-raised
//   --accent-text   -> --on-accent
//   --accent-soft   -> --accent-light
//   --danger(-bg)   -> --err-text / --err-border / --err-bg
//   --muted         -> --text-muted
//   --warn (bare)   -> --warn-text / --warn-border / --warn-bg
//   --motion-slow   -> --motion-base / --motion-gentle
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

// Each entry matches a dead token *referenced* via var(). --warn is bare-only
// (--warn-text/border/bg are valid), so it must not be followed by a hyphen.
const GHOST_PATTERNS: Array<[string, RegExp]> = [
  ['--surface1', /var\(\s*--surface1\b/],
  ['--surface2', /var\(\s*--surface2\b/],
  ['--surface3', /var\(\s*--surface3\b/],
  ['--accent-text', /var\(\s*--accent-text\b/],
  ['--accent-soft', /var\(\s*--accent-soft\b/],
  ['--danger', /var\(\s*--danger\b/],
  ['--muted', /var\(\s*--muted\b/],
  ['--warn (bare)', /var\(\s*--warn(?![-\w])/],
  ['--motion-slow', /var\(\s*--motion-slow\b/],
];

describe('ghost tokens (T35 migration)', () => {
  const files = cssFiles(srcRoot);

  it('finds CSS files to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const [name, pattern] of GHOST_PATTERNS) {
    it(`never references the retired token ${name}`, () => {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
      expect(
        offenders,
        `${name} is a retired token — replace with its successor (see this file's header). Found in:\n${offenders.join('\n')}`
      ).toEqual([]);
    });
  }
});
