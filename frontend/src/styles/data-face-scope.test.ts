/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

/**
 * The data face is for data (STYLE_GUIDE § Typography: prices, quantities,
 * set codes, tabular numerals), never for prose.
 *
 * `.empty-state` set `font-family: var(--font-mono)` for the whole block. Its
 * tagline and hint override it back, but anything else inherits: every
 * link-styled CTA in an empty state ("Build a deck", "Track a game") rendered
 * in IBM Plex Mono beside serif buttons that set their own font. The import
 * panel's description sentences had the same rule.
 *
 * So no rule may give the data face to a prose container: an empty state, a
 * hint, a description, a caption, a tagline, a subtitle. The check reads the
 * element a selector actually styles (its last compound), so a `<code>` inside
 * a hint stays allowed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

const PROSE_CLASS =
  /\.(empty-state[\w-]*|[\w-]+-(hint|desc|description|caption|tagline|subtitle|explainer))(?![\w-])/;

function subject(selector: string): string {
  const parts = selector.trim().split(/\s*[\s>+~]\s*/);
  return parts[parts.length - 1] ?? '';
}

describe('data face scope', () => {
  it('never sets the data face on a prose container', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcRoot)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const [, selectors, body] = m;
        if (!/font-family\s*:\s*var\(--font-mono\)/.test(body)) continue;
        for (const sel of selectors.split(',')) {
          if (PROSE_CLASS.test(subject(sel)))
            offenders.push(`${relative(srcRoot, file)}: ${sel.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the slider value words and suffix off the data face', () => {
    const css = readFileSync(join(here, 'deck-builder-customizer.css'), 'utf8');
    const rule = (sel: string) =>
      css.match(new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.deck-customizer-slider-value-suffix')).toMatch(/var\(--font-serif\)/);
    expect(rule('.deck-customizer-slider-value.is-word')).toMatch(/var\(--font-serif\)/);
  });
});
