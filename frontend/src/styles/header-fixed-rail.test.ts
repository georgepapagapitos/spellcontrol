/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The site header sits on one rail on every route (STYLE_GUIDE § Device
 * tiers → Width caps). #1953 widened the card-grid routes to --page-max-wide
 * by overriding --page-max on the shell, and the header — capped by the same
 * token — followed: the brand and account menu jumped ~260px between
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
