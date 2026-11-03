/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, '../pages/DecksIndexPage.tsx'), 'utf8');
const display = readFileSync(join(here, 'deck-builder-display.css'), 'utf8');
const index = readFileSync(join(here, 'deck-builder-decks-index.css'), 'utf8');

/** The rule for `selector` inside a `@media (max-width: 599px)` block, or null. */
function phoneRule(css: string, selector: string): string | null {
  const re = /@media \(max-width: 599px\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const block = css.slice(m.index + m[0].length, i - 1);
    const at = block.indexOf(`${selector} {`);
    if (at !== -1) return block.slice(at, block.indexOf('}', at));
  }
  return null;
}

/**
 * The 2026-11-03 phone shot showed Select alone on a third row at 360px even
 * though it is in the bar's markup: the three controls sum to 327px of a
 * 328px row, so the bar wrapped. On a phone the bar must not wrap, and the
 * sort pill must be able to shrink so it is the control that gives.
 */
describe('DK-10: the /decks sort bar stays one row on a phone', () => {
  it('does not wrap below 600px', () => {
    expect(phoneRule(index, '.decks-index-sort-bar')).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('lets the sort pill shrink and ellipsize its value', () => {
    expect(phoneRule(index, '.decks-index-sort-bar > .toolbar-popover')).toMatch(/min-width:\s*0/);
    expect(
      phoneRule(
        index,
        '.decks-index-sort-bar > .toolbar-popover > .toolbar-pill > .toolbar-pill-value'
      )
    ).toMatch(/text-overflow:\s*ellipsis/);
  });
});

/**
 * DK-10: on a phone the multi-select "Select" button must share the sort/view
 * row, not sit alone on a third toolbar row. It is the last child of the
 * sort bar, and its idle label is the compact kind that drops to an icon at
 * phone width so the three controls fit one row.
 */
describe('DK-10: /decks Select toggle lives in the sort/view row', () => {
  const bar = tsx.slice(tsx.indexOf('className="decks-index-sort-bar"'));
  const barEnd = bar.indexOf('{(showImport');

  it('renders SelectToggle inside the sort bar, after the view-mode toggle', () => {
    const body = bar.slice(0, barEnd);
    expect(body).toContain('<SelectToggle');
    expect(body.indexOf('<ViewModeToggle')).toBeGreaterThan(-1);
    expect(body.indexOf('<SelectToggle')).toBeGreaterThan(body.indexOf('<ViewModeToggle'));
  });

  it('does not render a second toolbar row for it', () => {
    expect(tsx.match(/<SelectToggle/g)).toHaveLength(1);
  });

  it('collapses the idle Select label to an icon at phone width', () => {
    expect(display).toMatch(
      /@media \(max-width: 599px\)\s*\{\s*:is\(\.toolbar-pill, \.pill-btn\):not\(\[aria-pressed='true'\]\) > \.toolbar-label-compact\s*\{\s*display: none;/
    );
  });
});
