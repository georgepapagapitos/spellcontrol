/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'collection.css'), 'utf8');

/**
 * The card table is ONE slab: `is-framed` puts the border, the radius and the
 * surface on the frame, and the column header and row lists inside go flush.
 *
 * A binder used to carry the PAGE-GRID section markup into the table instead —
 * `.binder-section` + `.section-header-toggle`, which are right above a block
 * of full-size card pages and wrong above rows. The result was three
 * unconnected boxes: the column header in one, a section bar floating in the
 * gap between, and the rows in a third with all four corners rounded.
 *
 * Two things here are easy to break by looking reasonable, so they're pinned:
 * the frame's overflow keyword, and where a group row pins.
 */

/** Body of the first rule whose selector matches, `{}` excluded. */
function rule(selector: RegExp): string {
  const m = new RegExp(selector.source + String.raw`\s*\{([^}]*)\}`, 's').exec(css);
  expect(m, `no rule for ${selector}`).toBeTruthy();
  return (m as RegExpExecArray)[1];
}

describe('the framed table is one slab', () => {
  const frame = rule(/\.collection-table\.is-framed/);

  it('carries the border, radius and surface on the frame', () => {
    expect(frame).toMatch(/border:\s*1px solid var\(--border\)/);
    expect(frame).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(frame).toMatch(/background:\s*var\(--surface-raised\)/);
  });

  it('clips its corners with `clip`, never `hidden`', () => {
    // `overflow: hidden` makes the frame a scroll container, which re-parents
    // the sticky header to the table's own box — it would then never move,
    // and the columns would scroll away with the rows. `clip` does not.
    expect(frame).toMatch(/overflow:\s*clip/);
    expect(frame).not.toMatch(/overflow:\s*(hidden|auto|scroll)/);
  });

  it('strips the inner boxes so nothing double-borders', () => {
    for (const inner of [
      /\.collection-table\.is-framed \.collection-table-head/,
      /\.collection-table\.is-framed \.collection-list\.is-table/,
    ]) {
      const body = rule(inner);
      expect(body).toMatch(/border:\s*0/);
      expect(body).toMatch(/border-radius:\s*0/);
    }
  });
});

describe('a binder group row pins under the column header', () => {
  const group = rule(/\.collection-table\.is-framed \.binder-table-section/);

  it('is sticky below the hub tabs AND the header, not at either alone', () => {
    expect(group).toMatch(/position:\s*sticky/);
    // Both terms: the tab strip the page sits under, and the header's own
    // height. Dropping either parks the group row on top of the columns or
    // halfway down the list.
    expect(group).toMatch(/top:\s*calc\([^)]*--hub-tabs-sticky-h/);
    expect(group).toMatch(/--ct-head-h/);
  });

  it('layers under the column header and over the rows', () => {
    expect(group).toMatch(/z-index:\s*calc\(var\(--z-dropdown\) - 1\)/);
  });

  it('reads the header height from a token, not a repeated 32px', () => {
    // The header is 32px on fine pointers and 44px on coarse. A literal in the
    // group row's `top` would be right on a desktop and 12px wrong on a phone.
    expect(rule(/\.collection-table-head/)).toMatch(/height:\s*var\(--ct-head-h\)/);
    expect(css).toMatch(/--ct-head-h:\s*32px/);
    expect(css).toMatch(/--ct-head-h:\s*44px/);
  });
});
