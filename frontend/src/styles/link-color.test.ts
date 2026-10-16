/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * Links take a theme color (STYLE_GUIDE § Color & spacing, "Always theme
 * variables"; ui-tells.md: "both themes, chosen tokens for each").
 *
 * No stylesheet had a base `a` rule, so any link whose own class set no color
 * painted the browser default: #0000EE on Azorius paper, #9E9EFF on Dimir
 * leather, and purple once visited. The 2026-10-15 audit measured it on /you's
 * "View your public profile" (`.text-link`). The fix is one base rule at zero
 * specificity (`:where(a)`), so every link-shaped class still wins.
 *
 *   1. The base rule exists and its color is a theme token.
 *   2. It stays at zero specificity: a bare `a { color }` or `a:hover { color }`
 *      would beat or tie the classes that color buttons, tiles and nav links.
 *   3. `.text-link`, the plain in-sentence link, sets no literal color of its own.
 */
const stylesDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(stylesDir, '..');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const base = strip(readFileSync(join(stylesDir, 'base-layout.css'), 'utf8'));

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Every rule as [selector list, body], @media wrappers flattened. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].trim(), m[2]]);
  return out;
}

describe('links take a theme color', () => {
  it('base-layout.css colors every link with a theme token, at zero specificity', () => {
    const rule = rules(base).find(([sel]) => /^:where\(\s*a\s*\)$/.test(sel));
    expect(rule, 'missing the `:where(a) { color: var(--…) }` base rule').toBeDefined();
    expect(rule![1]).toMatch(/(^|;|\s)color:\s*var\(--accent\)/);
  });

  it('no stylesheet colors a bare `a` or `a:<state>` outside :where()', () => {
    const hits: string[] = [];
    for (const file of cssFiles(srcRoot)) {
      for (const [sel, body] of rules(strip(readFileSync(file, 'utf8')))) {
        if (!/(^|;|\s)color\s*:/.test(body)) continue;
        for (const one of sel.split(',').map((s) => s.trim())) {
          if (/^a(:[a-z-]+)*$/.test(one)) hits.push(`${relative(srcRoot, file)}: ${one}`);
        }
      }
    }
    expect(hits, `a bare link selector outranks link-shaped classes:\n${hits.join('\n')}`).toEqual(
      []
    );
  });

  it('.text-link sets no literal color, so it reads the base rule', () => {
    const forms = strip(readFileSync(join(stylesDir, 'forms-banners.css'), 'utf8'));
    const bodies = rules(forms)
      .filter(([sel]) => sel.split(',').some((s) => s.trim() === '.text-link'))
      .map(([, body]) => body);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const color = body.match(/(^|;|\s)color\s*:\s*([^;]+)/)?.[2]?.trim();
      if (color) expect(color, '.text-link color must be a token').toMatch(/^var\(--/);
    }
  });
});
