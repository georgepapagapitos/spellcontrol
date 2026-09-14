/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

// ONE class owns a layer.
//
// Two single-class selectors both carrying `z-index` have identical specificity
// (0,1,0), so which one wins is decided by stylesheet ORDER — and that order is
// an output of Vite's chunking, not something any source file states. The
// account menu shipped at z-index 50 (under every sticky bar at --z-popover: 60)
// for exactly this reason: `.deck-row-menu-popover { z-index: var(--z-dropdown) }`
// lived in the entry CSS while `.overflow-menu-popover { z-index: var(--z-menu) }`
// lived in OverflowMenu's own chunk, which the built index.html <link>s FIRST.
// Both classes are applied to the same portaled panel, so the entry rule won and
// every kebab in the app — collection, decks, binders, lists — painted behind the
// page chrome it was opened from.
//
// The rule: when a className applies several classes to one element, at most one
// of them may declare `z-index`. Raise or lower the layer on that owner.
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(srcRoot);

/** class name -> files declaring `z-index` on a bare `.class {}` selector. */
const owners = new Map<string, string[]>();
for (const file of files.filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(file, 'utf8');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?<![-\w])z-index\s*:/.test(m[2])) continue;
    for (const raw of m[1].split(',')) {
      const sel = raw.trim().split('\n').pop()!.trim();
      if (!/^\.[\w-]+$/.test(sel)) continue;
      const key = sel.slice(1);
      const list = owners.get(key) ?? [];
      if (!list.includes(file)) list.push(file);
      owners.set(key, list);
    }
  }
}

describe('z-index ownership', () => {
  it('no element applies two z-index-declaring classes at once', () => {
    const collisions: string[] = [];
    for (const file of files.filter(
      (f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.test.')
    )) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:className|panelClassName)\s*=\s*[{"'`]+([^"'`{}$]+)/g)) {
        const hits = [...new Set(m[1].split(/\s+/).filter((c) => owners.has(c)))];
        if (hits.length > 1) {
          collisions.push(
            `${relative(srcRoot, file)}: ${hits
              .map(
                (c) =>
                  `.${c} (${owners
                    .get(c)!
                    .map((f) => relative(srcRoot, f))
                    .join(', ')})`
              )
              .join(' + ')}`
          );
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('the portaled OverflowMenu panel clears sticky page chrome', () => {
    const tokens = readFileSync(join(srcRoot, 'styles/tokens.css'), 'utf8');
    const value = (name: string) =>
      Number(new RegExp(`--z-${name}:\\s*(\\d+)`).exec(tokens)?.[1] ?? NaN);
    // --z-popover is the tier every sticky header/tab/controls row sits on.
    expect(value('menu')).toBeGreaterThan(value('popover'));
    expect(readFileSync(join(srcRoot, 'components/OverflowMenu.css'), 'utf8')).toMatch(
      /\.overflow-menu-popover\s*\{[^}]*z-index:\s*var\(--z-menu\)/
    );
  });
});
