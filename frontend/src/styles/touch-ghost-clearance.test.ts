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

/** px value of a length: `10px`, `0.5rem`, `var(--x)`, or a calc() of sums/differences of products. */
function px(expr: string): number {
  const body = expr
    .trim()
    .replace(/^calc\((.*)\)$/, '$1')
    .replace(/\s+-\s+/g, ' + -1 * ');
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
    // The name is the shared InlineRename button now; its rule carries the
    // `.binder-hero-name` bump so it beats the primitive's base.
    const slackEm = parseFloat(decl(deck, '.deck-editor-name.binder-hero-name', 'padding'));
    const nameSize = px(
      decl(deck, '.deck-editor-hero--art .deck-editor-name.binder-hero-name', 'font-size', phone)
    );
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

  it("the deck hero's meta links stay off the name above and each other (E465)", () => {
    // The format is the meta line's first segment, straight under the deck
    // name (InlineRename's button, sized by `.deck-editor-name.binder-hero-name`),
    // whose box reaches 0.22em below its text. The line's content starts below
    // that slack at the largest name size.
    const deck = read('styles/deck-builder-editor.css');
    const name = '.deck-editor-name.binder-hero-name';
    const slack = parseFloat(decl(deck, name, 'padding')) * px(decl(deck, name, 'font-size'));
    const gap = px(decl(deck, '.deck-editor-hero-text', 'gap'));
    const pad = px(
      decl(deck, '.deck-editor-hero .binder-hero-meta:has(> .deck-format-link)', 'padding-top')
    );
    expect(
      gap + pad,
      `meta line starts ${gap + pad}px under the name, its box reaches ${slack}px`
    ).toBeGreaterThanOrEqual(slack - 1e-6);
    // InlineRename's own coarse ghost (44px, centred) stays inside the name's
    // box because the box clips it.
    expect(decl(deck, name, 'overflow')).toBe('hidden');

    // On a coarse pointer each link is as tall as its own 44px line box: the
    // line sets the height, the link inherits it and adds no padding.
    const lineHeight = decl(
      deck,
      '.deck-editor-hero .binder-hero-meta:has(> .deck-meta-link)',
      'line-height',
      after(deck, '@media (pointer: coarse) {\n  .deck-editor-hero .binder-hero-meta')
    );
    expect(px(lineHeight)).toBe(44);
    expect(decl(deck, '.deck-meta-link', 'font')).toBe('inherit');
    expect(decl(deck, '.deck-meta-link', 'padding')).toBe('0');

    // So no meta link may grow a ghost: an inline link can't know which line
    // it's on, and any reach past its line box lands on the name or on the
    // other line's links.
    for (const f of ['styles/deck-builder-editor.css', 'components/deck/DeckVisibilityChip.css']) {
      expect(read(f), f).not.toMatch(
        /\.(deck-meta-link|deck-format-link|deck-visibility-chip)[\w-]*::(after|before)/
      );
    }
  });

  it("the deck checks' Fix in Coach links stay off the next row's link", () => {
    // Nightly journey 2026-09-28: `.btn-link loses its bottom edge to
    // .btn-link` on ?view=stats. The fix links stack one per check row, and
    // the shared `.btn-link` ghost (44px, centred) is taller than a row, so
    // each one reached into the next row's link.
    const card = read('components/deck/DeckIdentityCard.css');
    const shared = read('styles/forms-banners.css');
    const row = px(decl(card, '.deck-identity-card-check', 'min-height'));
    const ghost = px(
      decl(shared, '.btn-link::after', 'height', after(shared, '@media (pointer: coarse)'))
    );
    const reach = (ghost - row) / 2;
    expect(reach, `shared ghost reaches ${reach}px past a ${row}px check row`).toBeGreaterThan(0);

    // So in a check row the link carries its own 44px, which the row grows
    // around, and grows no ghost.
    const coarse = after(card, '@media (pointer: coarse) {\n  .deck-identity-card-check .btn-link');
    expect(px(decl(card, '.deck-identity-card-check .btn-link', 'min-height', coarse))).toBe(44);
    expect(decl(card, '.deck-identity-card-check .btn-link::after', 'content', coarse)).toBe(
      'none'
    );
  });
});
