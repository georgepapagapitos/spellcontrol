/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// The pull-to-refresh spinner (`.ptr-host`) is a sticky, zero-height strip at
// the top of `.app-main` that descends a badge as the user drags down. That top
// edge is exactly where every sticky page strip pins (hub tabs, search rows,
// table heads), and `.app-main` is not a stacking context, so the spinner and
// those strips compete on z-index alone. It shipped at a raw `5` and slid
// under the deck index tabs on every phone. The fix is a token above sticky
// chrome and below the app frame; this test holds every sticky rule in the
// tree under it, so a new strip can't reopen the bug on another page.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

// Sticky chrome that is NOT inside `.app-main`, so it never meets the spinner:
// the site header is `.app-main`'s sibling, and the share brand bar renders in
// SharedShell, outside <Layout>.
const OUTSIDE_APP_MAIN = new Set(['.site-header', '.shared-brandbar']);

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(p, out);
    else if (entry.name.endsWith('.css')) out.push(p);
  }
  return out;
}

const tokens = new Map<string, number>();
for (const m of read('styles/tokens.css').matchAll(/(--z-[\w-]+):\s*(-?\d+)\s*;/g)) {
  tokens.set(m[1], Number(m[2]));
}

/** Resolves `7`, `var(--z-x)` and `calc(var(--z-x) ± n)`; NaN otherwise. */
function resolveZ(value: string): number {
  const v = value.trim();
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = v.match(/^(?:calc\()?var\((--z-[\w-]+)\)(?:\s*([+-])\s*(\d+))?\)?$/);
  if (!m || !tokens.has(m[1])) return NaN;
  const base = tokens.get(m[1])!;
  return m[2] === '-' ? base - Number(m[3]) : m[2] === '+' ? base + Number(m[3]) : base;
}

type StickyRule = { file: string; selector: string; z: string };
const sticky: StickyRule[] = [];
for (const file of cssFiles(srcRoot)) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/position:\s*sticky/.test(m[2])) continue;
    const z = m[2].match(/z-index:\s*([^;]+)/);
    if (!z) continue; // `auto` never paints over a positive z-index
    sticky.push({
      file: relative(srcRoot, file).replace(/\\/g, '/'),
      selector: m[1].trim().replace(/\s+/g, ' '),
      z: z[1].trim(),
    });
  }
}

describe('pull-to-refresh spinner stacking', () => {
  const ptr = sticky.find((r) => r.selector === '.ptr-host');
  const ptrZ = resolveZ(ptr?.z ?? '');

  it('sits on its own token, under the app frame and every sheet', () => {
    expect(ptr?.z).toBe('var(--z-refresh)');
    expect(ptrZ).toBeLessThan(tokens.get('--z-panel')!);
  });

  it('finds the sticky chrome it has to clear (non-vacuity)', () => {
    expect(sticky.some((r) => r.selector.includes('.collection-hub-tabs'))).toBe(true);
    expect(sticky.length).toBeGreaterThan(10);
  });

  const inApp = sticky.filter((r) => r !== ptr && !OUTSIDE_APP_MAIN.has(r.selector));
  it.each(inApp.map((r) => [`${r.file} ${r.selector}`, r] as const))(
    '%s stays under the spinner',
    (_, rule) => {
      const z = resolveZ(rule.z);
      expect(z, `can't resolve z-index "${rule.z}"; use a --z-* token`).not.toBeNaN();
      expect(z).toBeLessThan(ptrZ);
    }
  );
});
