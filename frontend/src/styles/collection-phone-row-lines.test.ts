/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listRowEstimate } from '@/components/collection/card-list-table-config';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');

/**
 * Phone card rows: the name owns the row (E602).
 *
 * After the type floor (E594) the glyph, rarity, set chip, mana cost, menu and
 * price kept their width on a single line and the name took what was left:
 * "Angu…", "Comma…" on a 320px phone. At <=599px the row is a grid: the name
 * spans line 1, the meta + mana + price sit on line 2, and the thumbnail and
 * the menu span both. `main` and `right` are `display: contents` so CardRow's
 * markup, and every wider tier, is untouched. If this fails, a phone row has
 * slid back to one line; fix the grid in collection.css, don't loosen this.
 */
const phoneBlock = (() => {
  const start = css.indexOf('/* Phone rows are two lines');
  expect(start, 'the phone-rows comment is gone').toBeGreaterThan(-1);
  const open = css.indexOf('@media (max-width: 599px) {', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open, i + 1);
  }
  throw new Error('unterminated phone block');
})();

const rule = (selector: string) => {
  const head = phoneBlock.indexOf(`\n  ${selector} {`);
  if (head < 0) return '';
  const open = phoneBlock.indexOf('{', head);
  return phoneBlock.slice(open + 1, phoneBlock.indexOf('}', open));
};

const T = '.collection-list:not(.is-compact) ';

describe('phone collection rows: thumbnail view is two lines', () => {
  it('the row is a two-row grid that excludes the compact view', () => {
    const body = rule(`${T}.collection-list-row:not(.collection-table-row)`);
    expect(body, 'no grid rule for thumbnail rows').toBeTruthy();
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/grid-template-rows:\s*auto auto/);
    expect(body).toMatch(/column-gap:\s*0/);
  });

  it('main and right dissolve so their children are the grid items', () => {
    const body = rule(`${T}.collection-list-main,
  ${T}.collection-list-right`);
    expect(body).toMatch(/display:\s*contents/);
  });

  it('the name is on line 1 and the meta, mana and price are on line 2', () => {
    expect(rule(`${T}.collection-list-name`)).toMatch(/grid-row:\s*1;/);
    expect(rule(`${T}.collection-list-meta`)).toMatch(/grid-row:\s*2/);
    expect(rule(`${T}.collection-list-row > .mana-cost-row`)).toMatch(/grid-row:\s*2/);
    expect(rule(`${T}.collection-list-price`)).toMatch(/grid-row:\s*2/);
  });

  it('the thumbnail and the menu span both lines, the menu at the trailing edge', () => {
    expect(
      rule(`${T}.collection-list-check,
  ${T}.collection-list-thumb`)
    ).toMatch(/grid-row:\s*1 \/ 3/);
    const menu = rule(`${T}.collection-list-right > .deck-row-menu`);
    expect(menu).toMatch(/grid-row:\s*1 \/ 3/);
    expect(menu).toMatch(/grid-column:\s*6/);
  });
});

describe('phone collection rows: compact stays one line', () => {
  it('compact is never put on the grid', () => {
    expect(phoneBlock).not.toMatch(
      /\.collection-list\.is-compact[^{]*\{[^}]*display:\s*(grid|contents)/
    );
  });

  it('compact drops the type glyph, rarity and set chip so the name wins', () => {
    expect(rule('.collection-list.is-compact .collection-list-meta')).toMatch(/display:\s*none/);
  });
});

describe('phone collection rows: compact reserves nothing for an empty quantity', () => {
  it('hides the aria-hidden qty cell', () => {
    expect(rule(".collection-list.is-compact .collection-list-qty[aria-hidden='true']")).toMatch(
      /display:\s*none/
    );
  });
});

describe('phone collection rows: virtualizer estimates', () => {
  it('a phone thumbnail row seeds at its two-line height', () => {
    expect(listRowEstimate('list', true)).toBe(68);
  });

  it('compact keeps its one-line estimate at every tier', () => {
    expect(listRowEstimate('compact', true)).toBe(32);
    expect(listRowEstimate('compact', false)).toBe(32);
  });

  it('wider tiers keep the one-line thumbnail estimate', () => {
    expect(listRowEstimate('list', false)).toBe(66);
  });
});
