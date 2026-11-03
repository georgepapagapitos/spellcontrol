/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, '../pages/DecksIndexPage.tsx'), 'utf8');
const display = readFileSync(join(here, 'deck-builder-display.css'), 'utf8');

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
