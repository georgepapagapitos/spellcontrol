/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The site header sits on one rail on every route (STYLE_GUIDE § Device
 * tiers → Width caps). #1953 widened the card-grid routes to a 1920px
 * --page-max on the shell, and the header — capped by the same token —
 * followed: the brand and account menu jumped ~260px between
 * Collection and Play/Home on a wide monitor. The header now caps at its own
 * --header-max, which nothing per-route may override.
 *
 * Fix for a failure here: cap `.site-header-inner` with `var(--header-max)`,
 * define that token once in tokens.css as a fixed length, and never set it
 * inside a route-scoped selector — widen the page, not the chrome.
 */
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseLayout = readFileSync(join(srcRoot, 'styles', 'base-layout.css'), 'utf8');
const tokens = readFileSync(join(srcRoot, 'styles', 'tokens.css'), 'utf8');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

function block(css: string, selector: string): string {
  const open = css.indexOf(selector);
  expect(open, `${selector} not found`).toBeGreaterThan(-1);
  const start = css.indexOf('{', open);
  return css.slice(start, css.indexOf('}', start));
}

describe('site header rail', () => {
  it('caps .site-header-inner with --header-max, not the per-route --page-max', () => {
    const rule = block(baseLayout, '.site-header-inner {');
    expect(rule).toMatch(/max-width:\s*var\(--header-max\)/);
    expect(rule).not.toMatch(/--page-max/);
  });

  it('defines --header-max once, as a fixed length', () => {
    const defs = tokens.match(/--header-max:\s*[^;]+;/g) ?? [];
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatch(/--header-max:\s*\d+px;/);
  });

  it('no stylesheet overrides --header-max per route', () => {
    const offenders = cssFiles(srcRoot)
      .filter((f) => !f.endsWith('tokens.css'))
      .filter((f) => /--header-max\s*:/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

/**
 * One page frame (2026-10-09). The header and every page share one width, so
 * a page's title starts under the brand on every route. Before this the
 * Collection, Decks and deck-editor routes overrode --page-max to 1920px, and
 * Cube, Compare, Goldfish, Rules, Search and Tags each centered their own
 * narrower column: on a 2000px screen the title sat anywhere from x=46 to
 * x=723 against a brand at 300. A page whose content reads better narrow
 * keeps a max-width but stays left-aligned under its title.
 *
 * Fix for a failure here: drop the route-scoped --page-max override, or the
 * page root's auto inline margins (and its own side padding: .app-main owns
 * the gutter).
 */
describe('one page frame', () => {
  const allCss = cssFiles(srcRoot)
    .filter((f) => !/\.test\./.test(f))
    .map(
      (f) =>
        [
          f.slice(srcRoot.length + 1),
          readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
        ] as const
    );

  it('defines --page-max once, the same length as --header-max', () => {
    const defs = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
    const page = [...defs.matchAll(/--page-max:\s*([^;]+);/g)].map((m) => m[1].trim());
    const header = defs.match(/--header-max:\s*([^;]+);/)?.[1].trim();
    expect(page).toEqual([header]);
  });

  it('no stylesheet overrides --page-max per route', () => {
    const offenders = allCss
      .filter(([f]) => !f.endsWith('tokens.css'))
      .filter(([, css]) => /--page-max\s*:/.test(css))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('no page root centers itself inside the frame', () => {
    // A root is a class ending in -page (or -page--variant) as the last
    // compound of the selector: `.rules-page`, not `.rules-page-header`.
    // Two exemptions, neither a page in the frame: `.proxy-print-page` is a
    // printed sheet (@media print) that centers on the paper, and
    // `.catalog-page` is the /dev/catalog specimen sheet whose fixed geometry
    // the Visual catalog check photographs (moving it changes every shot).
    const exempt = new Set(['.proxy-print-page', '.catalog-page']);
    const offenders: string[] = [];
    for (const [f, css] of allCss) {
      for (const [, sel, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const roots = sel.split(',').map((s) => s.trim().split(/\s+/).pop() ?? '');
        if (!roots.some((s) => /\.[a-z-]+-page(--[a-z-]+)?$/.test(s) && !exempt.has(s))) continue;
        if (/margin-inline\s*:\s*auto|margin\s*:[^;]*\bauto\b/.test(body)) {
          offenders.push(`${f}: ${sel.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
