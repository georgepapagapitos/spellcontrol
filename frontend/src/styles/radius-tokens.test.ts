/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// T41 guard: the corner-radius language is two tokens defined once in
// tokens.css — `--radius` (8px, action buttons) and `--radius-lg` (12px,
// container surfaces). See STYLE_GUIDE.md § "Shape language — corners".
//
// CSS is NOT typecheck/eslint/CI-gated, so radius drift is otherwise silent.
// The specific bug this guards against: a declaration like
// `border-radius: var(--radius-sm)` references a token that tokens.css does
// NOT define and that has no fallback → the whole declaration is dropped →
// the element renders with SQUARE corners with nothing in the gate to catch
// it. Dead fallbacks (`var(--radius, 0.4rem)`) are banned too: they mask the
// token's real value and read as "this token might be undefined" when it
// isn't.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheets off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

const files = cssFiles(srcRoot);
const byFile = files.map((f) => ({ file: f, css: readFileSync(f, 'utf8') }));

describe('radius tokens (T41 shape language)', () => {
  const tokensCss = readFileSync(join(srcRoot, 'styles', 'tokens.css'), 'utf8');

  it('defines exactly --radius and --radius-lg in tokens.css', () => {
    for (const token of ['--radius', '--radius-lg']) {
      expect(
        new RegExp(`${token}\\s*:`).test(tokensCss),
        `${token} should be defined in tokens.css`
      ).toBe(true);
    }
    // No other --radius-* token exists, so referencing one elsewhere is a bug.
    const defined = [...tokensCss.matchAll(/(--radius[\w-]*)\s*:/g)].map((m) => m[1]).sort();
    expect(defined).toEqual(['--radius', '--radius-lg']);
  });

  it('never references an undefined --radius-* token (silent square-corner bug)', () => {
    // Any var(--radius-<x>) where the token isn't --radius / --radius-lg.
    const re = /var\(\s*(--radius-[\w-]+)\s*[,)]/g;
    const offenders: string[] = [];
    for (const { file, css } of byFile) {
      for (const m of css.matchAll(re)) {
        if (m[1] !== '--radius-lg') {
          const line = css.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line} → var(${m[1]})`);
        }
      }
    }
    expect(
      offenders,
      `undefined radius tokens (declaration silently drops → square corners):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('never uses a fallback on a radius token (masks the real value)', () => {
    // Bans var(--radius, …) / var(--radius-lg, …): the token is always defined,
    // so a fallback is dead code that hides drift.
    const re = /var\(\s*--radius[\w-]*\s*,/g;
    const offenders: string[] = [];
    for (const { file, css } of byFile) {
      for (const m of css.matchAll(re)) {
        const line = css.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line} → ${m[0].replace(/\s+/g, ' ')}…)`);
      }
    }
    expect(
      offenders,
      `dead fallbacks on always-defined radius tokens:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
