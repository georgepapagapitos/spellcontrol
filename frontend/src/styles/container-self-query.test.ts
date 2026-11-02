/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : cssFiles(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

/** The text between the braces that open at `open`, balanced. */
function block(css: string, open: number): string {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return css.slice(open + 1);
}

/**
 * Selectors that are a size container, mapped to their container name (or
 * null). Plain `selector { … container…: … }` rules only; that is how every
 * container in this tree is declared.
 */
function containers(css: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*container(?:-type)?\s*:[^{}]*)\}/g)) {
    const selector = m[1].split('*/').pop()!.trim();
    const name =
      m[2].match(/container-name\s*:\s*([\w-]+)/)?.[1] ??
      m[2].match(/container\s*:\s*([\w-]+)\s*\//)?.[1] ??
      null;
    out.set(selector, name);
  }
  return out;
}

/**
 * An `@container` query is evaluated against an ANCESTOR container, never the
 * element's own. The pregame card declared `container-type` on `.pregame-card`
 * and put its row layout in an `@container (min-width: 560px)` rule on that
 * same `.pregame-card`, so the query matched nothing and the art stacked above
 * the facts at every width (found in a real-browser pass, 2026-11-02). Put the
 * container on a wrapper, or name a different ancestor container.
 */
describe('@container rules never style their own container', () => {
  it('finds the CSS files and at least one container to check', () => {
    const files = cssFiles(src);
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => containers(readFileSync(f, 'utf8')).size > 0)).toBe(true);
  });

  it('no rule inside an @container block targets the selector that is the container', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(src)) {
      const css = readFileSync(file, 'utf8');
      const own = containers(css);
      if (own.size === 0) continue;
      for (const q of css.matchAll(/@container\s*([\w-]*)\s*\(/g)) {
        const body = block(css, css.indexOf('{', q.index!));
        for (const r of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
          for (const raw of r[1].split(',')) {
            const selector = raw.trim();
            if (!own.has(selector)) continue;
            // A query naming another container is evaluated against that one.
            if (q[1] === '' || q[1] === own.get(selector)) {
              offenders.push(
                `${relative(src, file)}: ${selector} inside @container ${q[1]}`.trim()
              );
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
