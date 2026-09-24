/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CARD_TABLE_COLUMNS } from '../components/shared/CardTable';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');

/**
 * Two things the card table got wrong the first time it rendered outside
 * Collection, both of which read as "the table is broken" rather than as a
 * CSS bug, and neither of which an existing test could see.
 *
 * 1. A column track sized for its DATA, not its HEADER. `--ct-w-qty` was
 *    `3ch` — fine for "999", 25px short of the word "QTY" plus a 14px sort
 *    arrow. The header cell is `overflow: hidden` and right-aligned, so the
 *    label was clipped from the LEFT and read "TY" (or "↓TY" while the
 *    column was the active sort). Every track is checked against its own
 *    label here, so the next column added to the vocabulary cannot ship too
 *    narrow to say its own name.
 *
 * 2. A sticky header pinned at `top: 0` on a surface whose scrollport top is
 *    behind the hub's sticky tab strip, so it slid under the tabs and the
 *    columns went unlabelled for the whole scroll.
 */

/** The base (non-@container) `.collection-table` block that declares the tracks. */
function baseBlock(): string {
  const start = css.indexOf('\n.collection-table {');
  expect(start, '.collection-table track block not found').toBeGreaterThan(-1);
  const open = css.indexOf('{', start);
  let depth = 1;
  let i = open + 1;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  return css.slice(open + 1, i - 1);
}

/**
 * The narrowest this track can ever resolve to, in rem. `minmax(a, b)` can
 * reach `a`; a single value is fixed. A track sized in any other unit fails
 * on purpose — `ch` is measured against the wrapper's font, not the header's
 * smaller uppercase one, which is how `3ch` passed review.
 */
function minRem(col: string, value: string): number {
  const min = value.startsWith('minmax(')
    ? value.slice(7, value.indexOf(',')).trim()
    : value.trim();
  if (min === '0' || min === '0px') return 0;
  const m = /^([\d.]+)rem$/.exec(min);
  expect(m, `--ct-w-${col} is "${min}" — size a column track in rem`).toBeTruthy();
  return parseFloat((m as RegExpExecArray)[1]);
}

/**
 * What the header needs, in rem. Measured in Chromium against the built
 * sheet: `--text-xs` (0.72rem) uppercase at weight 600 with 0.04em tracking
 * runs 8.3–10.2px per character depending on the letters ("MANA" is the
 * widest, "PRICE" the narrowest), so 0.6rem (9.6px) is the conservative
 * per-character figure. Plus the cell's `padding-inline-end` (--space-2),
 * and — only for a column the vocabulary marks `sortable` — the 14px
 * `SortDirArrow` and its 2px gap.
 */
const PER_CHAR = 0.6;
const CELL_PADDING = 0.5;
const SORT_ARROW = 1;

describe('card table column tracks fit their own headers', () => {
  const block = baseBlock();
  const declared = new Map<string, string>();
  for (const [, col, value] of block.matchAll(/--ct-w-([\w-]+):\s*([^;]+);/g)) {
    declared.set(col, value.trim());
  }

  it('declares a track for every column in the vocabulary', () => {
    expect([...declared.keys()].sort()).toEqual(Object.keys(CARD_TABLE_COLUMNS).sort());
  });

  for (const [col, { label, sortable }] of Object.entries(CARD_TABLE_COLUMNS)) {
    const needed = label ? label.length * PER_CHAR + CELL_PADDING + (sortable ? SORT_ARROW : 0) : 0;
    it(`${col} has at least ${needed}rem for "${label.toUpperCase()}"`, () => {
      const value = declared.get(col);
      expect(value, `no --ct-w-${col}`).toBeTruthy();
      expect(
        minRem(col, value as string),
        `--ct-w-${col} (${value}) can collapse below the width of its own header label`
      ).toBeGreaterThanOrEqual(needed);
    });
  }
});

describe('the sticky column header clears the hub tab strip', () => {
  it('pins beneath the tabs on the surfaces nested under them', () => {
    // Keyed on the page showing hub tabs: the strip sits inside the page under
    // its header (T135), so a `.collection-hub-tabs ~ *` sibling form can't see it.
    const rule =
      /\.app-main:has\(\.collection-hub-tabs\)\s*\.collection-table-head\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'a table under the hub tabs pins at the scrollport top, behind them').toBeTruthy();
    expect((rule as RegExpExecArray)[1]).toMatch(/top:\s*calc\(var\(--hub-tabs-sticky-h\)/);
  });

  it('keeps the top-of-scrollport default for surfaces with no chrome above', () => {
    const head = /\n\.collection-table-head \{([^}]*)\}/.exec(css);
    expect(head).toBeTruthy();
    expect((head as RegExpExecArray)[1]).toMatch(/top:\s*0;/);
  });
});
