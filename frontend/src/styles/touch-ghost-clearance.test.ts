/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(src, f), 'utf8');
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A 44px coarse-pointer target is only a floor if it doesn't take its
 * neighbour's pixels. Two did (nightly journey, E455): the binder page header's
 * centred ghost reached 2.5px into the section header button above it, and the
 * deck hero's absolute back link covered the top of the deck name's rename
 * button once the hero's meta wrapped. The journey caught both, but only on the
 * nights the data happened to fill the space; this holds the arithmetic every
 * run. Lengths resolve through tokens.css at 16px per rem.
 */

const tokens = new Map<string, number>();
for (const [, name, value] of read('styles/tokens.css').matchAll(
  /--([\w-]+):\s*([\d.]+rem|[\d.]+px);/g
))
  if (!tokens.has(name)) tokens.set(name, parseFloat(value) * (value.endsWith('rem') ? 16 : 1));

/** px value of a length: `10px`, `0.5rem`, `var(--x)`, or a calc() of sums of products. */
function px(expr: string): number {
  const body = expr.trim().replace(/^calc\((.*)\)$/, '$1');
  return body.split(/\s+\+\s+/).reduce(
    (sum, term) =>
      sum +
      term.split(/\s*\*\s*/).reduce((prod, factor) => {
        const v = /^var\(--([\w-]+)\)$/.exec(factor);
        if (v) {
          const t = tokens.get(v[1]);
          if (t === undefined) throw new Error(`unknown token --${v[1]}`);
          return prod * t;
        }
        const n = parseFloat(factor);
        if (Number.isNaN(n)) throw new Error(`can't read length "${factor}" in "${expr}"`);
        return prod * n * (factor.endsWith('rem') ? 16 : 1);
      }, 1),
    0
  );
}

/** A declaration's value in the first `selector { … }` rule after `from`. */
function decl(css: string, selector: string, prop: string, from = 0): string {
  const rule = new RegExp(`(?:^|\\n)\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, 'g');
  rule.lastIndex = from;
  for (let m = rule.exec(css); m; m = rule.exec(css)) {
    const v = new RegExp(`(?:^|;|\\s)${escape(prop)}:\\s*([^;]+);`).exec(m[1]);
    if (v) return v[1].trim();
  }
  throw new Error(`no ${prop} on ${selector}`);
}
const after = (css: string, marker: string) => {
  const i = css.indexOf(marker);
  if (i < 0) throw new Error(`no "${marker}"`);
  return i;
};

describe('coarse-pointer ghosts stay off their neighbours', () => {
  it("the binder page header's ghost fits between the section header and the page's slots", () => {
    const css = read('styles/binder-grid-slots.css');
    const coarse = after(css, '@media (pointer: coarse) {\n  .page-num-link {');
    const row = px(decl(css, '.page-num-link', 'min-height', coarse));
    const ghost = px(decl(css, '.page-num-link::after', 'height', coarse));
    const reach = (ghost - row) / 2; // centred: top 50% + translateY(-50%)
    const above = px(decl(css, '.section-header', 'margin-bottom'));
    // Below: the page-wrap gap, then the page's own border and padding.
    const below =
      px(decl(css, '.page-wrap', 'gap')) +
      px(decl(css, '.page', 'border').split(' ')[0]) +
      px(decl(css, '.page', 'padding'));
    expect(ghost).toBe(44);
    expect(
      reach,
      `ghost reaches ${reach}px up, section header is ${above}px away`
    ).toBeLessThanOrEqual(above);
    expect(
      reach,
      `ghost reaches ${reach}px down, first slot is ${below}px away`
    ).toBeLessThanOrEqual(below);
  });

  it("the deck hero's back-link lane holds the coarse link and the name's slack", () => {
    const deck = read('styles/deck-builder-editor.css');
    const phone = after(deck, '@media (max-width: 599px) {');
    const linkTop = px(decl(deck, '.deck-editor-hero--art > .back-link', 'top', phone));
    const linkFloor = px(
      decl(
        read('styles/binder-card-management.css'),
        '.back-link',
        'min-height',
        after(
          read('styles/binder-card-management.css'),
          '@media (pointer: coarse) {\n  .back-link {'
        )
      )
    );
    // The name's box starts 0.22em above its text (padding cancelled by a
    // negative margin), at the phone art hero's font size.
    const slackEm = parseFloat(decl(deck, '.deck-editor-name', 'padding'));
    const nameSize = px(decl(deck, '.deck-editor-hero--art .deck-editor-name', 'font-size', phone));
    const lane = px(
      decl(
        deck,
        '.deck-editor-hero--art',
        'padding-top',
        after(deck, '@media (max-width: 599px) and (pointer: coarse) {')
      )
    );
    expect(linkFloor).toBe(44);
    expect(
      lane,
      `lane ${lane}px < link ${linkTop}+${linkFloor} + name slack ${slackEm * nameSize}`
    ).toBeGreaterThanOrEqual(linkTop + linkFloor + slackEm * nameSize);
  });
});
