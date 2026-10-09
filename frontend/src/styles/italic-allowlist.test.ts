/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

// The default body face (Eczar) ships no italic, so every `font-style: italic`
// is a browser-slanted upright: the same defect STYLE_GUIDE § Typography bans
// for faux bold on the display face. Italic is reserved for card-text
// conventions, because the printed cards use it. Anything else says
// "secondary" with `--text-muted` / `--text-secondary` and stays upright.
//
// To add a selector here, it must render card text (reminder text, flavor
// text, an italic span of oracle text), and the entry says which.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED: Record<string, string> = {
  '.rules-text-reminder': 'reminder text, italic on the printed card',
  '.card-text-flavor': 'flavor text, italic on the printed card',
  '.daily-clue-value.is-prose': "the Daily card's printed text clue",
};

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}

describe('font-style: italic', () => {
  it('appears only on card-text selectors', () => {
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/font-style:\s*italic/.test(m[2])) continue;
        const selector = m[1].replace(/\s+/g, ' ').trim();
        seen.add(selector);
        if (!(selector in ALLOWED)) {
          offenders.push(`${relative(SRC, file).split(sep).join('/')}: ${selector}`);
        }
      }
    }
    expect(
      offenders,
      'italic is for card text only; drop font-style and use a muted color (STYLE_GUIDE § Typography)'
    ).toEqual([]);
    expect([...seen].sort(), 'an allowlist entry no longer matches a rule: delete it').toEqual(
      Object.keys(ALLOWED).sort()
    );
  });
});
