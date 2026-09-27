/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The gap between a button's icon and its label is one value, `--icon-gap`
 * (tokens.css), set by the three button families themselves. Before T152 W8e
 * `.btn` set none, so 26 surfaces each added their own (0.2rem, 0.3rem,
 * 0.35rem, 0.375rem, 0.4rem, 0.45rem, 6px, --space-1, --space-2) and a dozen
 * icon buttons that no surface covered had the glyph touching the label.
 *
 * So: the base rule of each family reads the token, and no other rule whose
 * selector lands on a family class may set `gap`. (A modifier class carried
 * on a Button, say `.my-cta { gap: … }`, can't be seen from CSS alone; the
 * STYLE_GUIDE § Buttons ruling covers those.)
 */
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAMILY = /\.(btn|pill-btn|toolbar-pill)(?![\w-])/;
const BASES: Array<[file: string, selector: string]> = [
  ['styles/tabs.css', '.btn'],
  ['styles/binder-hero.css', '.pill-btn'],
  ['styles/deck-builder-display.css', '.toolbar-pill'],
];

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** [selector, body, line] for every innermost rule, comments blanked out. */
function rules(css: string): Array<[string, string, number]> {
  const masked = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  return [...masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    m[1].trim().replace(/\s+/g, ' '),
    m[2],
    masked.slice(0, m.index).split('\n').length,
  ]);
}

describe('the icon gap belongs to the button families', () => {
  it('each family base rule takes its gap from --icon-gap', () => {
    for (const [file, selector] of BASES) {
      // A family selector appears more than once (a coarse-pointer floor, a
      // hover block); the base rule is the one that carries the gap.
      const bodies = rules(readFileSync(join(src, file), 'utf8'))
        .filter(([s]) => s === selector)
        .map(([, body]) => body);
      expect(
        bodies.some((body) => /\bgap:\s*var\(--icon-gap\)/.test(body)),
        `${selector} in ${file} does not take its gap from --icon-gap`
      ).toBe(true);
    }
  });

  it('no surface overrides it', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(src)) {
      const rel = relative(src, file).split(sep).join('/');
      for (const [selector, body, line] of rules(readFileSync(file, 'utf8'))) {
        if (!/(^|[\s;])gap\s*:/.test(body)) continue;
        if (BASES.some(([f, s]) => f === rel && s === selector)) continue;
        // The compound a rule lands on is the last one in each selector.
        const lands = selector
          .split(',')
          .map(
            (s) =>
              s
                .trim()
                .split(/\s+|>|\+|~/)
                .pop() ?? ''
          )
          .some((compound) => FAMILY.test(compound));
        if (lands) offenders.push(`${rel}:${line} ${selector}`);
      }
    }
    expect(
      offenders,
      'Drop the gap: the button family sets --icon-gap itself.\n  ' + offenders.join('\n  ')
    ).toEqual([]);
  });
});
