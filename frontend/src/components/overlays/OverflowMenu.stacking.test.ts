// @vitest-environment node
/**
 * Guard: the ⋮ menu's panel always clears `--z-overlay`.
 *
 * `OverflowMenu` portals its panel to `<body>`, so the panel only stacks
 * against other body children. Several full-screen surfaces are fixed at
 * `--z-overlay` (1100): the paper Horde table, the playtest board, the card
 * preview. A panel below that paints under the surface that opened it, with
 * nothing in the DOM or a render test to say so (jsdom loads no stylesheets).
 * The Horde table's game menu shipped exactly that way: Undo, End game and
 * Leave the table opened invisibly behind the table and could not be clicked.
 *
 * Fix a failure by giving the rule `--z-portal-popover` (or another token at
 * or above `--z-overlay`), never a lower per-instance override.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith('.css') ? [full] : [];
  });
}

/** Tokens at or above `--z-overlay` (1100) — see tokens.css. */
const CLEARS_OVERLAYS = /var\(--z-(overlay|portal-popover|tooltip)\)|calc\(\s*var\(--z-overlay\)/;

/** Every rule whose selector names the panel, with its z-index if it sets one. */
function panelRules(): { file: string; selector: string; zIndex: string | null }[] {
  const out: { file: string; selector: string; zIndex: string | null }[] = [];
  for (const file of cssFiles(srcDir)) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = match[1].trim();
      if (!selector.includes('overflow-menu-popover')) continue;
      out.push({
        file: relative(srcDir, file),
        selector,
        zIndex: /z-index:\s*([^;]+);/.exec(match[2])?.[1].trim() ?? null,
      });
    }
  }
  return out;
}

describe('OverflowMenu panel stacking', () => {
  const rules = panelRules();

  it('has a base rule to check, so the guard cannot pass by matching nothing', () => {
    expect(rules.some((r) => r.selector === '.overflow-menu-popover' && r.zIndex)).toBe(true);
  });

  it('never sets the panel below --z-overlay', () => {
    const low = rules.filter((r) => r.zIndex && !CLEARS_OVERLAYS.test(r.zIndex));
    expect(low).toEqual([]);
  });
});
